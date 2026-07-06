(function () {
  "use strict";
  const root = typeof self !== "undefined" ? self : window;
  root.AutoAnswer = root.AutoAnswer || {};

  root.AutoAnswer.WebSearch = {
    async search(questionText, opts) {
      const options = opts || {};
      const baseUrl = (options.baseUrl || "https://study.jszkk.com/api/open/seek").replace(/\/+$/, "");
      const timeoutMs = options.timeoutMs || 8000;
      const choices = Array.isArray(options.options) ? options.options : [];
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
          const validated = validateAnswer(answer, choices);
          if (!validated.ok) {
            return {
              success: true,
              answer,
              confidence: 0.45,
              sourceName: "全能搜题",
              displayAsText: true,
              warning: validated.error || "公开接口答案与选项不匹配",
              query,
              content: item && item.content,
              raw: item,
            };
          }
          return {
            success: true,
            answer: validated.answer,
            confidence: validated.confidence,
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
      .replace(/^[A-Da-d]\s*[\.\)、]\s*[^A-Da-d]+(?=\s+[A-Da-d]\s*[\.\)、]|$)/g, "")
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

  function validateAnswer(answer, choices) {
    if (!choices.length) {
      return { ok: true, answer, confidence: 0.78 };
    }

    const parsed = parseChoiceAnswer(answer);
    const normalizedAnswer = normalizeForCompare(answer);
    let best = null;

    choices.forEach((choice, index) => {
      const parsedChoice = parseChoiceAnswer(choice);
      const letter = parsedChoice.letter || String.fromCharCode(65 + index);
      const text = parsedChoice.text || String(choice || "");
      const normalizedChoice = normalizeForCompare(text);

      let score = 0;
      if (parsed.letter && parsed.letter === letter) score = 1;
      if (normalizedAnswer && normalizedChoice) {
        if (normalizedAnswer === normalizedChoice) score = Math.max(score, 0.98);
        if (normalizedAnswer.includes(normalizedChoice) || normalizedChoice.includes(normalizedAnswer)) {
          score = Math.max(score, 0.9);
        }
        score = Math.max(score, jaccard(normalizedAnswer, normalizedChoice));
      }

      if (!best || score > best.score) {
        best = { letter, text, score };
      }
    });

    if (!best || best.score < 0.55) {
      return { ok: false, error: "公开接口答案无法对应任何选项" };
    }

    return {
      ok: true,
      answer: best.letter + ". " + best.text,
      confidence: best.score >= 0.9 ? 0.82 : 0.68,
    };
  }

  function parseChoiceAnswer(text) {
    const raw = String(text || "").trim();
    const match = raw.match(/^([A-Da-d])(?:\s*[\.\)、]|\s*$)\s*(.*)$/);
    if (!match) return { letter: "", text: raw };
    return { letter: match[1].toUpperCase(), text: (match[2] || "").trim() };
  }

  function stripTrailingOptions(text) {
    return String(text || "")
      .replace(/\s+[A-Da-d]\s*[\.\)、]\s*[^A-Da-d]{1,80}(?=(?:\s+[A-Da-d]\s*[\.\)、])|$)/g, "")
      .trim();
  }

  function normalizeForCompare(text) {
    return String(text || "")
      .replace(/^[A-Da-d]\s*[\.\)、]?\s*/, "")
      .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
      .replace(/[^\w\u4e00-\u9fff]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function jaccard(a, b) {
    const setA = new Set(String(a || "").split(""));
    const setB = new Set(String(b || "").split(""));
    if (!setA.size || !setB.size) return 0;
    let inter = 0;
    for (const item of setA) if (setB.has(item)) inter++;
    return inter / new Set([...setA, ...setB]).size;
  }
})();
