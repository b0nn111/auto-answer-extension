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
      MATERIAL: "material",
      MATERIAL_AI: "material_ai",
      FREE_SEARCH: "free_search",
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
      GET_MATERIAL_LIBRARY: "GET_MATERIAL_LIBRARY",
      MATERIAL_CREATE_FOLDER: "MATERIAL_CREATE_FOLDER",
      MATERIAL_ADD_FILE: "MATERIAL_ADD_FILE",
      MATERIAL_SET_FOLDER_ENABLED: "MATERIAL_SET_FOLDER_ENABLED",
      MATERIAL_SET_FILE_ENABLED: "MATERIAL_SET_FILE_ENABLED",
      MATERIAL_DELETE_FOLDER: "MATERIAL_DELETE_FOLDER",
      MATERIAL_DELETE_FILE: "MATERIAL_DELETE_FILE",
    },

    DEFAULT_OLLAMA_URL: "http://localhost:11434",
    DEFAULT_OLLAMA_MODEL: "qwen2.5:7b",
    DEFAULT_AI_API_URL: "https://api.deepseek.com/v1",
    DEFAULT_AI_MODEL: "deepseek-chat",
    DEFAULT_FREE_SEARCH_URL: "https://study.jszkk.com/api/open/seek",
    FUZZY_MATCH_THRESHOLD: 0.85,
    CACHE_LIMIT: 10000,
    AI_API_TIMEOUT_MS: 15000,
  };
})();

