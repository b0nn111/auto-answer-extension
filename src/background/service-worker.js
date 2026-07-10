importScripts(
  "../lib/types.js",
  "../lib/matcher.js",
  "../lib/db.js",
  "../lib/material-db.js",
  "../lib/material-retriever.js",
  "../lib/websearch.js",
  "../lib/ollama.js",
  "../lib/deepseek.js"
);

(function () {
  "use strict";
  const { Types, DB, Matcher, MaterialDB, MaterialRetriever, WebSearch, Ollama, AiApi } = self.AutoAnswer;

  let settings = {
    ollamaUrl: Types.DEFAULT_OLLAMA_URL,
    ollamaModel: Types.DEFAULT_OLLAMA_MODEL,
    aiApiUrl: Types.DEFAULT_AI_API_URL, aiApiKey: "", aiApiModel: Types.DEFAULT_AI_MODEL,
    freeSearchEnabled: false,
    freeSearchUrl: Types.DEFAULT_FREE_SEARCH_URL,
    syncToken: "", syncRepo: "b0nn111/auto-answer-extension", syncPath: "question-bank.json",
  };

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
      });
    } catch (err) {
      const aiErr = settings.aiApiKey ? "自检异常" : "未配置";
      sendResponse({ aiApi: { configured: !!settings.aiApiKey, connected: false, error: aiErr }, ollama: { running: false, models: 0 }, freeSearch: { enabled: settings.freeSearchEnabled === true, url: settings.freeSearchUrl }, materials: { folders: 0, enabledFolders: 0, files: 0, enabledFiles: 0, chunks: 0 }, database: { available: false, totalCached: 0, totalMatches: 0 } });
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
      // Process all questions in parallel (with timeout)
      const pool = questions.map(q =>
        processQuestion(q).catch(() => ({ id: q.id, type: q.type, answer: "", source: Types.ANSWER_SOURCE.FAILED, confidence: 0, error: "处理异常" }))
      );
      const results = await Promise.all(pool);
      sendResponse(results);
    } catch (err) {
      sendResponse([]);
    }
  }

  async function processQuestion(q) {
    const hash = await Matcher.hashText(q.questionText);
    const candidates = [];
    const exact = await DB.getByHash(hash);
    if (exact) {
      await DB._incrementHit(hash, exact).catch(() => {});
      candidates.push(makeCandidate(q, exact.answer, Types.ANSWER_SOURCE.CACHE, exact.confidence, { cache: true }));
    } else {
      const fuzzy = await DB.fuzzySearch(q.questionText);
      if (fuzzy) candidates.push(makeCandidate(q, fuzzy.answer, Types.ANSWER_SOURCE.CACHE, fuzzy.confidence, { cache: true }));
    }
    const materialContext = await MaterialRetriever.retrieve(q.questionText, q.options).catch(() => []);
    if (settings.freeSearchEnabled) {
      const searchResult = await WebSearch.search(q.stemText || q.questionText, { baseUrl: settings.freeSearchUrl, options: q.options });
      if (searchResult.success) {
        candidates.push(makeCandidate(q, searchResult.answer, Types.ANSWER_SOURCE.FREE_SEARCH, searchResult.confidence, {
          displayAsText: searchResult.displayAsText === true,
          warning: searchResult.warning,
        }));
      } else {
        console.log("[答题助手] 免费搜题未命中:", searchResult.error);
      }
    }
    if (settings.ollamaUrl && await Ollama.checkRunning(settings.ollamaUrl).catch(() => false)) {
      const ollamaResult = await Ollama.ask(q.questionText, { baseUrl: settings.ollamaUrl, model: settings.ollamaModel, options: q.options, context: materialContext });
      if (ollamaResult.success) {
        candidates.push(makeCandidate(q, ollamaResult.answer, materialContext.length ? Types.ANSWER_SOURCE.MATERIAL_AI : Types.ANSWER_SOURCE.OLLAMA, materialContext.length ? Math.min(0.92, ollamaResult.confidence + 0.08) : ollamaResult.confidence, { materials: materialContext }));
      }
    }
    if (settings.aiApiKey) {
      const aiResult = await AiApi.ask(q.questionText, { apiKey: settings.aiApiKey, baseUrl: settings.aiApiUrl, model: settings.aiApiModel, options: q.options, context: materialContext });
      if (aiResult.success) {
        candidates.push(makeCandidate(q, aiResult.answer, materialContext.length ? Types.ANSWER_SOURCE.MATERIAL_AI : Types.ANSWER_SOURCE.AI_API, materialContext.length ? Math.min(0.96, aiResult.confidence + 0.04) : aiResult.confidence, { materials: materialContext }));
      } else {
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
        displayAsText: best.displayAsText === true,
        warning: best.warning,
        questionStem: q.stemText || q.questionText,
        candidates: ranked,
      };
    }
    return { id: q.id, type: q.type, answer: "", source: Types.ANSWER_SOURCE.FAILED, confidence: 0 };
  }

  function makeCandidate(q, answer, source, confidence, extra) {
    const optionMatch = matchOption(answer, q.options || []);
    const displayAsText = extra?.displayAsText === true || (q.type === Types.QUESTION_TYPE.CHOICE && !optionMatch);
    const adjustedConfidence = scoreCandidate(source, confidence, optionMatch, displayAsText);
    return {
      answer: optionMatch || String(answer || "").trim(),
      rawAnswer: String(answer || "").trim(),
      source,
      sourceLabel: sourceLabel(source),
      confidence: adjustedConfidence,
      displayAsText,
      warning: extra?.warning || (displayAsText && q.type === Types.QUESTION_TYPE.CHOICE ? "答案未能对应选项，按文本展示" : ""),
      materials: extra?.materials || [],
    };
  }

  function rankCandidates(candidates) {
    const seen = new Set();
    return candidates
      .filter((item) => item.answer)
      .sort((a, b) => b.confidence - a.confidence)
      .filter((item) => {
        const key = Matcher.normalizeText(item.source + ":" + item.answer);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function scoreCandidate(source, confidence, optionMatch, displayAsText) {
    const sourceBoost = {
      cache: 0.12,
      material_ai: 0.08,
      ai_api: 0.06,
      ollama: 0.03,
      free_search: -0.08,
      material: 0.04,
    }[source] || 0;
    const matchBoost = optionMatch ? 0.08 : 0;
    const textPenalty = displayAsText ? -0.18 : 0;
    return Math.max(0.05, Math.min(0.99, Number(confidence || 0.5) + sourceBoost + matchBoost + textPenalty));
  }

  function matchOption(answer, options) {
    if (!options || options.length === 0) return "";
    const parsed = parseChoiceText(answer);
    const normAnswer = Matcher.normalizeText(parsed.text || answer);
    let best = null;
    options.forEach((option, index) => {
      const parsedOption = parseChoiceText(option);
      const letter = parsedOption.letter || String.fromCharCode(65 + index);
      const text = parsedOption.text || String(option || "");
      const normOption = Matcher.normalizeText(text);
      let score = 0;
      if (parsed.letter && parsed.letter === letter) score = 1;
      if (normAnswer && normOption) {
        if (normAnswer === normOption) score = Math.max(score, 0.98);
        if (normAnswer.includes(normOption) || normOption.includes(normAnswer)) score = Math.max(score, 0.9);
        score = Math.max(score, Matcher.jaccardSimilarity(normAnswer, normOption));
      }
      if (!best || score > best.score) best = { score, letter, text };
    });
    return best && best.score >= 0.55 ? best.letter + ". " + best.text : "";
  }

  function parseChoiceText(text) {
    const raw = String(text || "").trim();
    const match = raw.match(/^([A-Da-d])(?:\s*[\.\)、]|\s*$)\s*(.*)$/);
    if (!match) return { letter: "", text: raw };
    return { letter: match[1].toUpperCase(), text: (match[2] || "").trim() };
  }

  function sourceLabel(source) {
    return {
      cache: "本地题库",
      material: "本地资料库",
      material_ai: "资料库+AI",
      free_search: "公共搜题",
      ollama: "本地 AI",
      ai_api: "AI API",
    }[source] || source;
  }
})();












