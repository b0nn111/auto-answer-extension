(function () {
  "use strict";
  const root = typeof self !== "undefined" ? self : window;
  root.AutoAnswer = root.AutoAnswer || {};

  root.AutoAnswer.WebSearch = {
    async search(questionText, opts) {
      const options = opts || {};
      const baseUrl = (options.baseUrl || "https://study.jszkk.com/api/open/seek").replace(/\/+$/, "");
      const timeoutMs = options.timeoutMs || 8000;
      const query = normalizeQuestion(questionText);

      if (!query || query.length < 4) {
        return { success: false, error: "题目文本太短" };
      }

      try {
        const resp = await fetch(baseUrl + "?q=" + encodeURIComponent(query.slice(0, 300)), {
          method: "GET",
          headers: { "Accept": "application/json" },
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (!resp.ok) return { success: false, error: "HTTP " + resp.status };

        const data = await resp.json();
        const item = data && data.data;
        const answer = formatAnswer(item && item.answer);

        if (data.code === 200 && answer) {
          return {
            success: true,
            answer,
            confidence: 0.82,
            sourceName: "全能搜题",
            raw: item,
          };
        }

        return { success: false, error: data.msg || "未命中" };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  };

  function normalizeQuestion(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .replace(/✅\s*[A-Da-d][^\n]*/g, "")
      .trim();
  }

  function formatAnswer(answer) {
    const text = String(answer || "").trim();
    if (!text) return "";
    return text
      .split("#")
      .map((part) => part.trim())
      .filter(Boolean)
      .join("；");
  }
})();
