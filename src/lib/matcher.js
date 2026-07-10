(function () {
  "use strict";
  const root = typeof self !== "undefined" ? self : window;
  root.AutoAnswer = root.AutoAnswer || {};

  root.AutoAnswer.Matcher = {
    normalizeText(text) {
      if (!text) return "";
      return text
        .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
        .replace(/[^\w\u4e00-\u9fff\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
    },

    async hashText(text) {
      const normalized = this.normalizeText(text);
      const data = new TextEncoder().encode(normalized);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    },

    jaccardSimilarity(a, b) {
      const normA = this.normalizeText(a);
      const normB = this.normalizeText(b);
      if (!normA || !normB) return 0;

      const ngram = (s, n = 2) => {
        const set = new Set();
        for (let i = 0; i <= s.length - n; i++) set.add(s.substring(i, i + n));
        return set;
      };

      const setA = ngram(normA);
      const setB = ngram(normB);
      let intersection = 0;
      for (const item of setA) if (setB.has(item)) intersection++;
      const union = new Set([...setA, ...setB]).size;
      return union === 0 ? 0 : intersection / union;
    },

    // ── Fast question signal detection ──
    // Uses querySelector instead of innerHTML regex (much faster)
    extractQuestionSignals(element) {
      const text = element.textContent || "";
      const cls = (element.className || "") + (element.id || "");

      const numberedPattern =
        /(?:^|\s)(?:\d+[\.\)、]|[\(（]\d+[\)）]|[①②③④⑤⑥⑦⑧⑨⑩]|Question\s*\d+|Q\.?\s*\d+|Quiz\s*\d+|Test\s*\d+|Exam\s*\d+|第\s*\d+\s*[题问])/i;

      const keywordPattern =
        /[题问]|question|problem|exercise|quiz|what|which|who|how|why|where|when|choose|select|identify|explain|describe|define|calculate|find|solve|determine|list|name|give|state|discuss|outline|summarize|compare|contrast|analyze|evaluate|prove|write|complete|fill/i;

      // Fast class/id check first (no DOM query needed)
      const hasClassSignal = /question|quiz|exam|problem|choice|answer/i.test(cls);

      // Use querySelector for child detection (native, fast)
      const hasRadio = element.querySelector('input[type="radio"]') !== null;
      const hasCheckbox = element.querySelector('input[type="checkbox"]') !== null;
      const hasTextInput =
        element.querySelector('input[type="text"], input[type="number"]') !== null ||
        element.querySelector("textarea") !== null;

      const signals = {
        hasNumberedPrefix: numberedPattern.test(text),
        hasQuestionKeyword: keywordPattern.test(text),
        hasClassSignal,
        hasRadio,
        hasCheckbox,
        hasTextInput,
        textLength: text.trim().length,
      };

      let score = 0;
      if (signals.hasNumberedPrefix) score += 3;
      if (signals.hasQuestionKeyword) score += 2;
      if (signals.hasClassSignal) score += 2;
      if (signals.hasRadio) score += 2;
      if (signals.hasCheckbox) score += 2;
      if (signals.hasTextInput) score += 2;
      if (text.trim().length > 20 && text.trim().length < 500) score += 1;

      return { signals, score };
    },
  };
})();

