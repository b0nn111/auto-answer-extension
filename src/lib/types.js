(function () {
  "use strict";
  const root = typeof self !== "undefined" ? self : window;
  root.AutoAnswer = root.AutoAnswer || {};

  root.AutoAnswer.Types = {
    QUESTION_TYPE: {
      CHOICE: "choice",
      FILL: "fill",
      SHORT_ANSWER: "short_answer",
      CODING: "coding",
      UNKNOWN: "unknown",
    },

    ANSWER_SOURCE: {
      CACHE: "cache",
      OLLAMA: "ollama",
      AI_API: "ai_api",
      FAILED: "failed",
    },

    MSG_TYPE: {
      DETECT_QUESTIONS: "DETECT_QUESTIONS",
      ANSWERS_RESULT: "ANSWERS_RESULT",
      SETTINGS_UPDATED: "SETTINGS_UPDATED",
      GET_STATS: "GET_STATS",
      STATS_RESULT: "STATS_RESULT",
      CLEAR_CACHE: "CLEAR_CACHE",
      OLLAMA_CHECK: "OLLAMA_CHECK",
      OLLAMA_LIST_MODELS: "OLLAMA_LIST_MODELS",
      UPDATE_PANEL_STATS: "UPDATE_PANEL_STATS",
      PANEL_TOGGLE: "PANEL_TOGGLE",
      RUN_DIAGNOSTIC: "RUN_DIAGNOSTIC",
    },

    DEFAULT_OLLAMA_URL: "http://localhost:11434",
    DEFAULT_OLLAMA_MODEL: "qwen2.5:7b",
    DEFAULT_AI_API_URL: "https://api.deepseek.com/v1",
    DEFAULT_AI_MODEL: "deepseek-chat",
    FUZZY_MATCH_THRESHOLD: 0.85,
    CACHE_LIMIT: 10000,
    AI_API_TIMEOUT_MS: 15000,
  };
})();

