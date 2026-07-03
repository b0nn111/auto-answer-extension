importScripts(
  "../lib/types.js",
  "../lib/matcher.js",
  "../lib/db.js",
  "../lib/websearch.js",
  "../lib/ollama.js",
  "../lib/deepseek.js"
);

(function () {
  "use strict";
  const { Types, DB, Matcher, WebSearch, Ollama, AiApi } = self.AutoAnswer;

  let settings = {
    ollamaUrl: Types.DEFAULT_OLLAMA_URL,
    ollamaModel: Types.DEFAULT_OLLAMA_MODEL,
    aiApiUrl: Types.DEFAULT_AI_API_URL, aiApiKey: "", aiApiModel: Types.DEFAULT_AI_MODEL,
    freeSearchEnabled: false,
    freeSearchUrl: Types.DEFAULT_FREE_SEARCH_URL,
    syncToken: "", syncRepo: "b0nn111/auto-answer-extension", syncPath: "question-bank.json",
  };

  (async function loadSettings() {
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
  })();

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
    }
  });

  async function handleDiagnostic(sendResponse) {
    try {
      const [models, stats, aiTest] = await Promise.all([
        Ollama.listModels(settings.ollamaUrl).catch(() => null),
        DB.getStats().catch(() => null),
        settings.aiApiKey ? AiApi.testConnection({ baseUrl: settings.aiApiUrl, apiKey: settings.aiApiKey, model: settings.aiApiModel }).catch(() => ({ ok: false, error: "测试异常" })) : Promise.resolve({ ok: false, error: "未配置" }),
      ]);
      sendResponse({
        aiApi: { configured: !!settings.aiApiKey, connected: aiTest.ok, error: aiTest.error },
        ollama: { running: models !== null, models: models ? models.length : 0 },
        freeSearch: { enabled: settings.freeSearchEnabled === true, url: settings.freeSearchUrl },
        database: { available: stats !== null, totalCached: stats ? stats.totalCached : 0, totalMatches: stats ? stats.totalMatches : 0 },
      });
    } catch (err) {
      const aiErr = settings.aiApiKey ? "自检异常" : "未配置";
      sendResponse({ aiApi: { configured: !!settings.aiApiKey, connected: false, error: aiErr }, ollama: { running: false, models: 0 }, freeSearch: { enabled: settings.freeSearchEnabled === true, url: settings.freeSearchUrl }, database: { available: false, totalCached: 0, totalMatches: 0 } });
    }
  }

  async function handleDetectQuestions(questions, sendResponse) {
    try {
      // Process all questions in parallel (with timeout)
      const pool = questions.map(q =>
        processQuestion(q).catch(() => ({ id: q.id, type: q.type, answer: "", source: Types.ANSWER_SOURCE.FAILED, confidence: 0 }))
      );
      const results = await Promise.all(pool);
      sendResponse(results);
    } catch (err) {
      sendResponse([]);
    }
  }

  async function processQuestion(q) {
    const hash = await Matcher.hashText(q.questionText);
    const exact = await DB.getByHash(hash);
    if (exact) {
      DB._incrementHit(hash, exact).catch(() => {});
      return { id: q.id, type: q.type, answer: exact.answer, source: Types.ANSWER_SOURCE.CACHE, confidence: exact.confidence };
    }
    const fuzzy = await DB.fuzzySearch(q.questionText);
    if (fuzzy) return { id: q.id, type: q.type, answer: fuzzy.answer, source: Types.ANSWER_SOURCE.CACHE, confidence: fuzzy.confidence };
    if (settings.freeSearchEnabled) {
      const searchResult = await WebSearch.search(q.questionText, { baseUrl: settings.freeSearchUrl });
      if (searchResult.success) {
        DB.addQuestion(q.questionText, searchResult.answer, q.options).catch(() => {});
        return { id: q.id, type: q.type, answer: searchResult.answer, source: Types.ANSWER_SOURCE.FREE_SEARCH, confidence: searchResult.confidence };
      }
      console.log("[答题助手] 免费搜题未命中:", searchResult.error);
    }
    if (settings.ollamaUrl) {
      const ollamaResult = await Ollama.ask(q.questionText, { baseUrl: settings.ollamaUrl, model: settings.ollamaModel, options: q.options });
      if (ollamaResult.success) {
        DB.addQuestion(q.questionText, ollamaResult.answer, q.options).catch(() => {});
        return { id: q.id, type: q.type, answer: ollamaResult.answer, source: Types.ANSWER_SOURCE.OLLAMA, confidence: ollamaResult.confidence };
      }
    }
    if (settings.aiApiKey) {
      const aiResult = await AiApi.ask(q.questionText, { apiKey: settings.aiApiKey, baseUrl: settings.aiApiUrl, model: settings.aiApiModel, options: q.options });
      if (aiResult.success) {
        DB.addQuestion(q.questionText, aiResult.answer, q.options).catch(() => {});
        return { id: q.id, type: q.type, answer: aiResult.answer, source: Types.ANSWER_SOURCE.AI_API, confidence: aiResult.confidence };
      }
        else {
        console.log("[答题助手] AI API 请求失败:", aiResult.error);
      }
    }
    return { id: q.id, type: q.type, answer: "", source: Types.ANSWER_SOURCE.FAILED, confidence: 0 };
  }
})();












