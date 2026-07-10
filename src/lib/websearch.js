(function () {
  "use strict";
  const root = typeof self !== "undefined" ? self : window;
  root.AutoAnswer = root.AutoAnswer || {};
  const { AnswerNormalizer } = root.AutoAnswer;

  root.AutoAnswer.WebSearch = {
    async search(questionText, opts) {
      const options = opts || {};
      const baseUrl = (options.baseUrl || "https://study.jszkk.com/api/open/seek").replace(/\/+$/, "");
      const timeoutMs = options.timeoutMs || 8000;
      const choices = Array.isArray(options.options) ? options.options : [];
      const multiple = options.multiple === true;
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
          const validated = choices.length ? AnswerNormalizer.match(answer, choices, multiple) : null;
          if (validated && !validated.matched) {
            return {
              success: true,
              answer,
              confidence: 0.45,
              sourceName: "全能搜题",
              displayAsText: true,
              warning: "公开接口答案无法对应选项",
              query,
              content: item && item.content,
              raw: item,
            };
          }
          return {
            success: true,
            answer: validated ? validated.answer : answer,
            confidence: validated ? (validated.score >= 0.9 ? 0.82 : 0.68) : 0.78,
            optionLetters: validated ? validated.letters : [],
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
    const cleaned = String(text || "")
      .replace(/\s+/g, " ")
      .replace(/^[A-Za-z]\s*[\.\)、]\s*[^A-Za-z]+(?=\s+[A-Za-z]\s*[\.\)、]|$)/g, "")
      .trim();
    return stripTrailingOptions(cleaned);
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

  function stripTrailingOptions(text) {
    return String(text || "")
      .replace(/\s+[A-Za-z]\s*[\.\)、]\s*[^A-Za-z]{1,80}(?=(?:\s+[A-Za-z]\s*[\.\)、])|$)/g, "")
      .trim();
  }

})();
