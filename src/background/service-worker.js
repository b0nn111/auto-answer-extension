importScripts(
  "../lib/types.js",
  "../lib/matcher.js",
  "../lib/answer-normalizer.js",
  "../lib/db.js",
  "../lib/material-db.js",
  "../lib/material-retriever.js",
  "../lib/material-answerer.js",
  "../lib/websearch.js",
  "../lib/ollama.js",
  "../lib/deepseek.js"
);

(function () {
  "use strict";
  const { Types, DB, Matcher, AnswerNormalizer, MaterialDB, MaterialRetriever, MaterialAnswerer, WebSearch, Ollama, AiApi } = self.AutoAnswer;

  let settings = {
    ollamaUrl: Types.DEFAULT_OLLAMA_URL,
    ollamaModel: Types.DEFAULT_OLLAMA_MODEL,
    aiApiUrl: Types.DEFAULT_AI_API_URL, aiApiKey: "", aiApiModel: Types.DEFAULT_AI_MODEL,
    freeSearchEnabled: false,
    freeSearchUrl: Types.DEFAULT_FREE_SEARCH_URL,
    materialFallbackEnabled: true,
    materialFallbackMinConfidence: Types.DEFAULT_MATERIAL_FALLBACK_MIN_CONFIDENCE,
  };
  const sourceMetrics = {};
  const MAX_QUESTION_CONCURRENCY = 4;
  const DEBUG_LOG_KEY = "debugLogs";
  const MAX_DEBUG_LOG_ENTRIES = 300;
  let debugLogWriteQueue = Promise.resolve();

  const settingsReady = loadSettings();

  async function loadSettings() {
    try {
      const s = await chrome.storage.sync.get(["ollamaUrl", "ollamaModel", "aiApiUrl", "aiApiKey", "aiApiModel", "deepseekKey", "freeSearchEnabled", "freeSearchUrl", "materialFallbackEnabled", "materialFallbackMinConfidence"]);
      if (s.ollamaUrl) settings.ollamaUrl = s.ollamaUrl;
      if (s.ollamaModel) settings.ollamaModel = s.ollamaModel;
      if (s.aiApiUrl) settings.aiApiUrl = s.aiApiUrl;
      if (s.aiApiKey !== undefined) settings.aiApiKey = s.aiApiKey;
      if (s.aiApiModel) settings.aiApiModel = s.aiApiModel;
      if (s.freeSearchEnabled !== undefined) settings.freeSearchEnabled = s.freeSearchEnabled === true;
      if (s.freeSearchUrl) settings.freeSearchUrl = s.freeSearchUrl;
      if (s.materialFallbackEnabled !== undefined) settings.materialFallbackEnabled = s.materialFallbackEnabled === true;
      if (s.materialFallbackMinConfidence !== undefined) settings.materialFallbackMinConfidence = normalizeMaterialFallbackMinConfidence(s.materialFallbackMinConfidence);
      // Migrate old deepseekKey setting
      if (!settings.aiApiKey && s.deepseekKey) settings.aiApiKey = s.deepseekKey;
    } catch (_) {}
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.type) {
      case Types.MSG_TYPE.DETECT_QUESTIONS:
        handleDetectQuestions(msg.questions, sendResponse);
        return true;
      case Types.MSG_TYPE.SETTINGS_UPDATED:
        settings = normalizeSettings({ ...settings, ...msg.settings });
        sendResponse({ ok: true });
        break;
      case Types.MSG_TYPE.GET_STATS:
        DB.getStats().then(sendResponse).catch(() => sendResponse({ totalCached: 0, totalMatches: 0 }));
        return true;
      case Types.MSG_TYPE.CLEAR_CACHE:
        DB.clearCache().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
        return true;
      case Types.MSG_TYPE.OLLAMA_CHECK:
        Ollama.checkRunning(settings.ollamaUrl).then(sendResponse).catch(() => sendResponse(false));
        return true;
      case Types.MSG_TYPE.OLLAMA_LIST_MODELS:
        Ollama.listModels(settings.ollamaUrl).then(sendResponse).catch(() => sendResponse([]));
        return true;
      case Types.MSG_TYPE.RUN_DIAGNOSTIC:
        handleDiagnostic(sendResponse);
        return true;
      case Types.MSG_TYPE.EXPORT_DEBUG_LOGS:
        handleExportDebugLogs(sendResponse);
        return true;
      case Types.MSG_TYPE.CLEAR_DEBUG_LOGS:
        clearDebugLogs().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
        return true;
      case Types.MSG_TYPE.GET_MATERIAL_LIBRARY:
        handleMaterialLibrary(sendResponse);
        return true;
      case Types.MSG_TYPE.MATERIAL_CREATE_FOLDER:
        MaterialDB.createFolder(msg.name).then(() => handleMaterialLibrary(sendResponse)).catch((err) => sendResponse({ ok: false, error: err.message }));
        return true;
      case Types.MSG_TYPE.MATERIAL_ADD_FILE:
        MaterialDB.addFileText(msg.folderId, msg.file, msg.text).then(() => handleMaterialLibrary(sendResponse)).catch((err) => sendResponse({ ok: false, error: err.message }));
        return true;
      case Types.MSG_TYPE.MATERIAL_SET_FOLDER_ENABLED:
        MaterialDB.updateFolderEnabled(msg.folderId, msg.enabled).then(() => handleMaterialLibrary(sendResponse)).catch((err) => sendResponse({ ok: false, error: err.message }));
        return true;
      case Types.MSG_TYPE.MATERIAL_SET_FILE_ENABLED:
        MaterialDB.updateFileEnabled(msg.fileId, msg.enabled).then(() => handleMaterialLibrary(sendResponse)).catch((err) => sendResponse({ ok: false, error: err.message }));
        return true;
      case Types.MSG_TYPE.MATERIAL_DELETE_FOLDER:
        MaterialDB.deleteFolder(msg.folderId).then(() => handleMaterialLibrary(sendResponse)).catch((err) => sendResponse({ ok: false, error: err.message }));
        return true;
      case Types.MSG_TYPE.MATERIAL_DELETE_FILE:
        MaterialDB.deleteFile(msg.fileId).then(() => handleMaterialLibrary(sendResponse)).catch((err) => sendResponse({ ok: false, error: err.message }));
        return true;
    }
  });

  async function handleDiagnostic(sendResponse) {
    try {
      await settingsReady;
      const [models, stats, materialStats, aiTest] = await Promise.all([
        Ollama.listModels(settings.ollamaUrl).catch(() => null),
        DB.getStats().catch(() => null),
        MaterialDB.getStats().catch(() => null),
        settings.aiApiKey ? AiApi.testConnection({ baseUrl: settings.aiApiUrl, apiKey: settings.aiApiKey, model: settings.aiApiModel }).catch(() => ({ ok: false, error: "测试异常" })) : Promise.resolve({ ok: false, error: "未配置" }),
      ]);
      sendResponse({
        aiApi: { configured: !!settings.aiApiKey, connected: aiTest.ok, error: aiTest.error },
        ollama: { running: models !== null, models: models ? models.length : 0 },
        freeSearch: { enabled: settings.freeSearchEnabled === true, url: settings.freeSearchUrl },
        materials: materialStats || { folders: 0, enabledFolders: 0, files: 0, enabledFiles: 0, chunks: 0 },
        database: { available: stats !== null, totalCached: stats ? stats.totalCached : 0, totalMatches: stats ? stats.totalMatches : 0 },
        sourceMetrics: snapshotMetrics(),
      });
    } catch (err) {
      const aiErr = settings.aiApiKey ? "自检异常" : "未配置";
      sendResponse({ aiApi: { configured: !!settings.aiApiKey, connected: false, error: aiErr }, ollama: { running: false, models: 0 }, freeSearch: { enabled: settings.freeSearchEnabled === true, url: settings.freeSearchUrl }, materials: { folders: 0, enabledFolders: 0, files: 0, enabledFiles: 0, chunks: 0 }, database: { available: false, totalCached: 0, totalMatches: 0 }, sourceMetrics: snapshotMetrics() });
    }
  }

  function normalizeSettings(nextSettings) {
    return {
      ...nextSettings,
      materialFallbackEnabled: nextSettings.materialFallbackEnabled === true,
      materialFallbackMinConfidence: normalizeMaterialFallbackMinConfidence(nextSettings.materialFallbackMinConfidence),
    };
  }

  async function handleMaterialLibrary(sendResponse) {
    try {
      const [folders, stats] = await Promise.all([
        MaterialDB.listFoldersWithFiles(),
        MaterialDB.getStats(),
      ]);
      sendResponse({ ok: true, folders, stats });
    } catch (err) {
      sendResponse({ ok: false, error: err.message, folders: [], stats: { folders: 0, enabledFolders: 0, files: 0, enabledFiles: 0, chunks: 0 } });
    }
  }

  async function handleExportDebugLogs(sendResponse) {
    try {
      await debugLogWriteQueue.catch(() => {});
      const store = await readDebugLogStore();
      const current = Array.isArray(store.current) ? store.current : [];
      const previous = Array.isArray(store.previous) ? store.previous : [];
      const entries = current.length ? current : previous;
      const fromPrevious = current.length === 0 && previous.length > 0;

      await saveDebugLogStore({
        current: [],
        previous: current.length ? current.slice(-MAX_DEBUG_LOG_ENTRIES) : [],
      });
      sendResponse({
        ok: true,
        entries,
        count: entries.length,
        fromPrevious,
        retainedUntilNextExport: current.length > 0,
      });
    } catch (err) {
      sendResponse({ ok: false, entries: [], count: 0, error: sanitizeError(err?.message || err) });
    }
  }

  async function handleDetectQuestions(questions, sendResponse) {
    try {
      await settingsReady;
      if (!Array.isArray(questions)) {
        sendResponse([]);
        return;
      }
      const results = await mapWithConcurrency(questions, MAX_QUESTION_CONCURRENCY, (q) =>
        processQuestion(q).catch(() => ({ id: q.id, type: q.type, answer: "", source: Types.ANSWER_SOURCE.FAILED, confidence: 0, error: "处理异常" }))
      );
      sendResponse(results);
    } catch (err) {
      sendResponse([]);
    }
  }

  async function processQuestion(q) {
    await writeDebugLog({ event: "question_start", question: summarizeQuestion(q) });
    const hash = await Matcher.hashText(q.questionText);
    const candidates = [];
    const cacheResult = await measureSource("cache", async () => {
      const exact = await DB.getByHash(hash);
      if (exact) {
        await DB._incrementHit(hash, exact).catch(() => {});
        return exact;
      }
      return DB.fuzzySearch(q.questionText);
    }, (value) => value ? "success" : "miss");
    await writeDebugLog({
      event: "cache_result",
      questionId: q.id,
      outcome: cacheResult ? "hit" : "miss",
      answerPreview: cacheResult ? sanitizeText(cacheResult.answer, 80) : "",
      confidence: cacheResult?.confidence || 0,
    });
    if (cacheResult) {
      candidates.push(makeCandidate(q, cacheResult.answer, Types.ANSWER_SOURCE.CACHE, cacheResult.confidence, { provider: Types.ANSWER_SOURCE.CACHE }));
    }

    const materialContext = await measureSource(
      "materials",
      () => MaterialRetriever.retrieve(q.questionText, q.options),
      (value) => value && value.length ? "success" : "miss"
    ) || [];
    await writeDebugLog({
      event: "materials_retrieved",
      questionId: q.id,
      outcome: materialContext.length ? "hit" : "miss",
      count: materialContext.length,
      materials: summarizeMaterials(materialContext),
    });

    if (settings.freeSearchEnabled) {
      const searchResult = await measureSource(
        "free_search",
        () => WebSearch.search(q.stemText || q.questionText, { baseUrl: settings.freeSearchUrl, options: q.options, multiple: q.multiple === true }),
        classifySearchResult
      );
      await writeDebugLog({
        event: "free_search",
        questionId: q.id,
        outcome: searchResult?.success ? "success" : classifySearchResult(searchResult),
        answerPreview: searchResult?.success ? sanitizeText(searchResult.answer, 100) : "",
        confidence: searchResult?.confidence || 0,
        error: sanitizeError(searchResult?.error || ""),
      });
      if (searchResult?.success) {
        candidates.push(makeCandidate(q, searchResult.answer, Types.ANSWER_SOURCE.FREE_SEARCH, searchResult.confidence, {
          displayAsText: searchResult.displayAsText === true,
          warning: searchResult.warning,
          provider: Types.ANSWER_SOURCE.FREE_SEARCH,
        }));
      } else if (searchResult) {
        console.log("[答题助手] 免费搜题未命中:", sanitizeError(searchResult.error));
      }
    }

    if (settings.ollamaUrl) {
      const ollamaResult = await measureSource("ollama", async () => {
        const running = await Ollama.checkRunning(settings.ollamaUrl).catch(() => false);
        if (!running) return { success: false, unavailable: true, error: "未运行" };
        return Ollama.ask(q.questionText, { baseUrl: settings.ollamaUrl, model: settings.ollamaModel, options: q.options, context: materialContext, multiple: q.multiple === true });
      }, (value) => value?.success ? "success" : (value?.unavailable ? "miss" : "error"));
      await writeDebugLog({
        event: "ollama",
        questionId: q.id,
        outcome: ollamaResult?.success ? "success" : (ollamaResult?.unavailable ? "miss" : "error"),
        answerPreview: ollamaResult?.success ? sanitizeText(ollamaResult.answer, 100) : "",
        confidence: ollamaResult?.confidence || 0,
        error: sanitizeError(ollamaResult?.error || ""),
      });
      if (ollamaResult?.success) {
        candidates.push(makeCandidate(q, ollamaResult.answer, materialContext.length ? Types.ANSWER_SOURCE.MATERIAL_AI : Types.ANSWER_SOURCE.OLLAMA, ollamaResult.confidence, { materials: materialContext, provider: Types.ANSWER_SOURCE.OLLAMA }));
      }
    }

    if (settings.aiApiKey) {
      const aiResult = await measureSource(
        "ai_api",
        () => AiApi.ask(q.questionText, { apiKey: settings.aiApiKey, baseUrl: settings.aiApiUrl, model: settings.aiApiModel, options: q.options, context: materialContext, multiple: q.multiple === true }),
        (value) => value?.success ? "success" : "error"
      );
      await writeDebugLog({
        event: "ai_api",
        questionId: q.id,
        outcome: aiResult?.success ? "success" : "error",
        answerPreview: aiResult?.success ? sanitizeText(aiResult.answer, 100) : "",
        confidence: aiResult?.confidence || 0,
        error: sanitizeError(aiResult?.error || ""),
      });
      if (aiResult?.success) {
        candidates.push(makeCandidate(q, aiResult.answer, materialContext.length ? Types.ANSWER_SOURCE.MATERIAL_AI : Types.ANSWER_SOURCE.AI_API, aiResult.confidence, { materials: materialContext, provider: Types.ANSWER_SOURCE.AI_API }));
      } else if (aiResult) {
        console.log("[答题助手] AI API 请求失败:", sanitizeError(aiResult.error));
      }
    }

    if (hasAiAnswerCandidate(candidates)) {
      await writeDebugLog({
        event: "material_answer_skipped",
        questionId: q.id,
        reason: "ai_answer_used_materials_as_rag",
      });
    } else {
      await addMaterialFallbackCandidate(q, materialContext, candidates);
    }

    const ranked = rankCandidates(candidates);
    if (ranked.length > 0) {
      const best = ranked[0];
      await writeDebugLog({
        event: "final_answer",
        questionId: q.id,
        source: best.source,
        provider: best.provider,
        answerPreview: sanitizeText(best.answer, 120),
        confidence: best.confidence,
        candidates: ranked.map(summarizeCandidate),
      });
      return {
        id: q.id,
        type: q.type,
        answer: best.answer,
        source: best.source,
        confidence: best.confidence,
        optionLetters: best.optionLetters,
        multiple: q.multiple === true,
        displayAsText: best.displayAsText === true,
        warning: best.warning,
        questionStem: q.stemText || q.questionText,
        materials: best.materials || [],
        candidates: ranked,
      };
    }
    if (materialContext.length > 0) {
      await writeDebugLog({
        event: "final_reference_only",
        questionId: q.id,
        source: Types.ANSWER_SOURCE.MATERIAL,
        reason: "materials_found_but_no_confident_answer",
        count: materialContext.length,
      });
      return {
        id: q.id,
        type: q.type,
        answer: "",
        source: Types.ANSWER_SOURCE.MATERIAL,
        confidence: 0,
        referenceOnly: true,
        materials: materialContext,
        questionStem: q.stemText || q.questionText,
      };
    }
    await writeDebugLog({
      event: "final_failed",
      questionId: q.id,
      reason: "no_source_returned_answer",
    });
    return { id: q.id, type: q.type, answer: "", source: Types.ANSWER_SOURCE.FAILED, confidence: 0 };
  }

  async function addMaterialFallbackCandidate(q, materialContext, candidates) {
    if (!MaterialAnswerer || !materialContext.length) return;
    if (settings.materialFallbackEnabled !== true) {
      await writeDebugLog({
        event: "material_answer_skipped",
        questionId: q.id,
        reason: "local_similarity_fallback_disabled",
      });
      return;
    }
    const materialAnswer = await measureSource(
      "material_answer",
      () => MaterialAnswerer.answer(q, materialContext),
      (value) => value?.success ? "success" : "miss"
    );
    await writeDebugLog({
      event: "material_answer",
      questionId: q.id,
      mode: "local_similarity_fallback",
      outcome: materialAnswer?.success ? "success" : "miss",
      answerPreview: materialAnswer?.success ? sanitizeText(materialAnswer.answer, 100) : "",
      confidence: materialAnswer?.confidence || 0,
      warning: sanitizeText(materialAnswer?.warning || "", 120),
      scores: summarizeMaterialScores(materialAnswer?.debug?.scores),
      minConfidence: settings.materialFallbackMinConfidence,
    });
    if (materialAnswer?.success) {
      if (Number(materialAnswer.confidence || 0) < settings.materialFallbackMinConfidence) {
        await writeDebugLog({
          event: "material_answer_rejected",
          questionId: q.id,
          reason: "below_min_confidence",
          confidence: materialAnswer.confidence || 0,
          minConfidence: settings.materialFallbackMinConfidence,
          answerPreview: sanitizeText(materialAnswer.answer, 100),
        });
        return;
      }
      candidates.push(makeCandidate(q, materialAnswer.answer, Types.ANSWER_SOURCE.MATERIAL, materialAnswer.confidence, {
        displayAsText: materialAnswer.displayAsText === true,
        materials: materialAnswer.materials,
        provider: Types.ANSWER_SOURCE.MATERIAL,
        warning: materialAnswer.warning,
      }));
    }
  }

  function normalizeMaterialFallbackMinConfidence(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return Types.DEFAULT_MATERIAL_FALLBACK_MIN_CONFIDENCE;
    return Math.max(0.3, Math.min(0.9, number));
  }

  function hasAiAnswerCandidate(candidates) {
    return candidates.some((candidate) =>
      candidate.provider === Types.ANSWER_SOURCE.AI_API ||
      candidate.provider === Types.ANSWER_SOURCE.OLLAMA
    );
  }

  function makeCandidate(q, answer, source, confidence, extra) {
    const rawAnswer = String(answer || "").trim();
    const choiceMatch = q.type === Types.QUESTION_TYPE.CHOICE
      ? AnswerNormalizer.match(rawAnswer, q.options || [], q.multiple === true)
      : { matched: false, answer: rawAnswer, letters: [] };
    const optionMatch = choiceMatch.matched === true;
    const displayAsText = q.type === Types.QUESTION_TYPE.CHOICE
      ? !optionMatch
      : extra?.displayAsText === true;
    const adjustedConfidence = scoreCandidate(source, confidence, optionMatch, displayAsText);
    const provider = extra?.provider || source;
    return {
      answer: optionMatch ? choiceMatch.answer : rawAnswer,
      rawAnswer,
      optionLetters: choiceMatch.letters || [],
      source,
      provider,
      sourceLabel: sourceLabel(source, provider),
      confidence: adjustedConfidence,
      baseConfidence: adjustedConfidence,
      displayAsText,
      warning: extra?.warning || (displayAsText && q.type === Types.QUESTION_TYPE.CHOICE
        ? "答案未能对应选项，按文本展示"
        : ""),
      materials: extra?.materials || [],
    };
  }

  function rankCandidates(candidates) {
    const seen = new Set();
    const uniqueCandidates = candidates
      .filter((item) => item.answer)
      .filter((item) => {
        const key = item.provider + ":" + candidateKey(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    const groups = new Map();
    uniqueCandidates.forEach((item) => {
      const key = candidateKey(item);
      if (!groups.has(key)) groups.set(key, new Set());
      groups.get(key).add(item.provider);
    });

    const ranked = uniqueCandidates
      .map((item) => {
        const providers = groups.get(candidateKey(item));
        const consensusCount = providers ? providers.size : 1;
        const agreementBoost = Math.min(0.2, Math.max(0, consensusCount - 1) * 0.1);
        return {
          ...item,
          confidence: clampConfidence(item.baseConfidence + agreementBoost),
          consensusCount,
          agreementSources: Array.from(providers || []),
        };
      })
      .sort((a, b) => b.confidence - a.confidence);

    if (ranked.length && groups.size > 1) {
      ranked[0].warning = appendWarning(ranked[0].warning, "不同来源答案存在冲突");
    }
    return ranked;
  }

  function scoreCandidate(source, confidence, optionMatch, displayAsText) {
    const sourceBoost = {
      cache: 0.05,
      material_ai: 0.03,
      ai_api: 0.01,
      ollama: 0,
      free_search: -0.04,
      material: 0.02,
    }[source] || 0;
    const matchBoost = optionMatch ? 0.03 : 0;
    const textPenalty = displayAsText ? -0.18 : 0;
    return clampConfidence(Number(confidence || 0.5) + sourceBoost + matchBoost + textPenalty);
  }

  function candidateKey(candidate) {
    if (candidate.optionLetters && candidate.optionLetters.length) {
      return "choice:" + candidate.optionLetters.slice().sort().join(",");
    }
    return "text:" + AnswerNormalizer.normalize(candidate.answer);
  }

  function clampConfidence(value) {
    return Math.max(0.05, Math.min(0.98, Number(value || 0.5)));
  }

  function appendWarning(current, next) {
    return current ? current + "；" + next : next;
  }

  async function measureSource(key, task, classify) {
    const startedAt = Date.now();
    try {
      const value = await task();
      const outcome = classify ? classify(value) : "success";
      recordMetric(key, outcome, Date.now() - startedAt, value?.error || "");
      return value;
    } catch (err) {
      recordMetric(key, "error", Date.now() - startedAt, err?.message || String(err));
      return null;
    }
  }

  function classifySearchResult(result) {
    if (result?.success) return "success";
    return /HTTP\s+\d+|timeout|timed out|fetch|network/i.test(result?.error || "") ? "error" : "miss";
  }

  function recordMetric(key, outcome, latencyMs, error) {
    const metric = sourceMetrics[key] || { requests: 0, successes: 0, misses: 0, failures: 0 };
    metric.requests++;
    if (outcome === "success") metric.successes++;
    else if (outcome === "miss") metric.misses++;
    else metric.failures++;
    metric.lastOutcome = outcome;
    metric.lastLatencyMs = Math.max(0, Math.round(latencyMs));
    metric.lastError = sanitizeError(error);
    sourceMetrics[key] = metric;
  }

  function snapshotMetrics() {
    return Object.fromEntries(Object.entries(sourceMetrics).map(([key, value]) => [key, { ...value }]));
  }

  function sanitizeError(error) {
    return sanitizeText(error, 160);
  }

  function sanitizeText(value, maxLength) {
    return String(value || "")
      .replace(/(api[_-]?key|authorization|bearer)\s*[:=]\s*[^\s,;]+/ig, "$1:[redacted]")
      .replace(/[A-Za-z0-9+/_=-]{36,}/g, "[redacted]")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLength || 120);
  }

  function summarizeQuestion(q) {
    return {
      id: q.id,
      type: q.type,
      multiple: q.multiple === true,
      preview: sanitizeText(q.stemText || q.questionText, 160),
      optionsCount: Array.isArray(q.options) ? q.options.length : 0,
    };
  }

  function summarizeMaterials(materials) {
    return (materials || []).slice(0, 5).map((item) => ({
      citation: sanitizeText(item.citation || [item.folderName, item.fileName].filter(Boolean).join(" / "), 120),
      score: Number(item.score || 0),
      pageNumber: item.pageNumber || null,
    }));
  }

  function summarizeCandidate(candidate) {
    return {
      source: candidate.source,
      provider: candidate.provider,
      confidence: candidate.confidence,
      answerPreview: sanitizeText(candidate.answer, 80),
      optionLetters: Array.from(candidate.optionLetters || []),
    };
  }

  function summarizeMaterialScores(scores) {
    return Array.isArray(scores)
      ? scores.slice(0, 8).map((item) => ({
        letter: item.letter,
        optionText: sanitizeText(item.optionText, 60),
        score: Number(item.score || 0),
      }))
      : [];
  }

  function writeDebugLog(entry) {
    debugLogWriteQueue = debugLogWriteQueue.then(async () => {
      const store = await readDebugLogStore();
      const current = Array.isArray(store.current) ? store.current : [];
      current.push({
        ts: new Date().toISOString(),
        ...entry,
      });
      await saveDebugLogStore({
        current: current.slice(-MAX_DEBUG_LOG_ENTRIES),
        previous: Array.isArray(store.previous) ? store.previous.slice(-MAX_DEBUG_LOG_ENTRIES) : [],
      });
    }).catch(() => {});
    return debugLogWriteQueue;
  }

  async function readDebugLogStore() {
    if (!chrome.storage?.local) return { current: [], previous: [] };
    const result = await chrome.storage.local.get(DEBUG_LOG_KEY);
    const store = result?.[DEBUG_LOG_KEY] || {};
    return {
      current: Array.isArray(store.current) ? store.current : [],
      previous: Array.isArray(store.previous) ? store.previous : [],
    };
  }

  async function saveDebugLogStore(store) {
    if (!chrome.storage?.local) return;
    await chrome.storage.local.set({ [DEBUG_LOG_KEY]: store });
  }

  async function clearDebugLogs() {
    await saveDebugLogStore({ current: [], previous: [] });
  }

  async function mapWithConcurrency(items, limit, mapper) {
    const results = new Array(items.length);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        results[index] = await mapper(items[index], index);
      }
    });
    await Promise.all(workers);
    return results;
  }

  function sourceLabel(source, provider) {
    if (source === Types.ANSWER_SOURCE.MATERIAL_AI) {
      return provider === Types.ANSWER_SOURCE.OLLAMA ? "资料库+本地 AI" : "资料库+AI API";
    }
    return {
      cache: "本地题库",
      material: "本地资料参考",
      free_search: "公共搜题",
      ollama: "本地 AI",
      ai_api: "AI API",
    }[source] || source;
  }
})();












