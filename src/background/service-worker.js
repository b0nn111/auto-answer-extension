importScripts(
  "../lib/types.js",
  "../lib/matcher.js",
  "../lib/answer-normalizer.js",
  "../lib/db.js",
  "../lib/material-db.js",
  "../lib/material-retriever.js",
  "../lib/websearch.js",
  "../lib/ollama.js",
  "../lib/deepseek.js"
);

(function () {
  "use strict";
  const { Types, DB, Matcher, AnswerNormalizer, MaterialDB, MaterialRetriever, WebSearch, Ollama, AiApi } = self.AutoAnswer;

  let settings = {
    ollamaUrl: Types.DEFAULT_OLLAMA_URL,
    ollamaModel: Types.DEFAULT_OLLAMA_MODEL,
    aiApiUrl: Types.DEFAULT_AI_API_URL, aiApiKey: "", aiApiModel: Types.DEFAULT_AI_MODEL,
    freeSearchEnabled: false,
    freeSearchUrl: Types.DEFAULT_FREE_SEARCH_URL,
  };
  const sourceMetrics = {};
  const MAX_QUESTION_CONCURRENCY = 4;

  const settingsReady = loadSettings();

  async function loadSettings() {
    try {
      const s = await chrome.storage.sync.get(["ollamaUrl", "ollamaModel", "aiApiUrl", "aiApiKey", "aiApiModel", "deepseekKey", "freeSearchEnabled", "freeSearchUrl"]);
      if (s.ollamaUrl) settings.ollamaUrl = s.ollamaUrl;
      if (s.ollamaModel) settings.ollamaModel = s.ollamaModel;
      if (s.aiApiUrl) settings.aiApiUrl = s.aiApiUrl;
      if (s.aiApiKey !== undefined) settings.aiApiKey = s.aiApiKey;
      if (s.aiApiModel) settings.aiApiModel = s.aiApiModel;
      if (s.freeSearchEnabled !== undefined) settings.freeSearchEnabled = s.freeSearchEnabled === true;
      if (s.freeSearchUrl) settings.freeSearchUrl = s.freeSearchUrl;
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
        settings = { ...settings, ...msg.settings };
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
    if (cacheResult) {
      candidates.push(makeCandidate(q, cacheResult.answer, Types.ANSWER_SOURCE.CACHE, cacheResult.confidence, { provider: Types.ANSWER_SOURCE.CACHE }));
    }

    const materialContext = await measureSource(
      "materials",
      () => MaterialRetriever.retrieve(q.questionText, q.options),
      (value) => value && value.length ? "success" : "miss"
    ) || [];

    if (settings.freeSearchEnabled) {
      const searchResult = await measureSource(
        "free_search",
        () => WebSearch.search(q.stemText || q.questionText, { baseUrl: settings.freeSearchUrl, options: q.options, multiple: q.multiple === true }),
        classifySearchResult
      );
      if (searchResult?.success) {
        candidates.push(makeCandidate(q, searchResult.answer, Types.ANSWER_SOURCE.FREE_SEARCH, searchResult.confidence, {
          displayAsText: searchResult.displayAsText === true,
          warning: searchResult.warning,
          provider: Types.ANSWER_SOURCE.FREE_SEARCH,
        }));
      } else if (searchResult) {
        console.log("[答题助手] 免费搜题未命中:", searchResult.error);
      }
    }

    if (settings.ollamaUrl) {
      const ollamaResult = await measureSource("ollama", async () => {
        const running = await Ollama.checkRunning(settings.ollamaUrl).catch(() => false);
        if (!running) return { success: false, unavailable: true, error: "未运行" };
        return Ollama.ask(q.questionText, { baseUrl: settings.ollamaUrl, model: settings.ollamaModel, options: q.options, context: materialContext, multiple: q.multiple === true });
      }, (value) => value?.success ? "success" : (value?.unavailable ? "miss" : "error"));
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
      if (aiResult?.success) {
        candidates.push(makeCandidate(q, aiResult.answer, materialContext.length ? Types.ANSWER_SOURCE.MATERIAL_AI : Types.ANSWER_SOURCE.AI_API, aiResult.confidence, { materials: materialContext, provider: Types.ANSWER_SOURCE.AI_API }));
      } else if (aiResult) {
        console.log("[答题助手] AI API 请求失败:", aiResult.error);
      }
    }
    const ranked = rankCandidates(candidates);
    if (ranked.length > 0) {
      const best = ranked[0];
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
        candidates: ranked,
      };
    }
    return { id: q.id, type: q.type, answer: "", source: Types.ANSWER_SOURCE.FAILED, confidence: 0 };
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
      warning: displayAsText && q.type === Types.QUESTION_TYPE.CHOICE
        ? (extra?.warning || "答案未能对应选项，按文本展示")
        : "",
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
    return String(error || "").replace(/\s+/g, " ").trim().slice(0, 160);
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
      material: "本地资料库",
      free_search: "公共搜题",
      ollama: "本地 AI",
      ai_api: "AI API",
    }[source] || source;
  }
})();












