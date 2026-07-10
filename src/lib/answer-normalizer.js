(function () {
  "use strict";
  const root = typeof self !== "undefined" ? self : window;
  root.AutoAnswer = root.AutoAnswer || {};

  function match(answer, choices, multiple) {
    const rawAnswer = String(answer || "").trim();
    const parsedChoices = (Array.isArray(choices) ? choices : [])
      .map(parseOption)
      .filter((choice) => choice.text);
    if (!rawAnswer || !parsedChoices.length) {
      return { matched: false, answer: rawAnswer, letters: [], score: 0 };
    }

    const validLetters = parsedChoices.map((choice) => choice.letter);
    let letters = extractLetters(rawAnswer, validLetters, multiple === true);
    if (letters.length) {
      if (multiple !== true) letters = letters.slice(0, 1);
      const selected = parsedChoices.filter((choice) => letters.includes(choice.letter));
      if (selected.length === letters.length) return matchedResult(selected, 1);
    }

    const normalizedAnswer = normalize(stripAnswerPrefix(rawAnswer));
    if (multiple === true) {
      const contained = parsedChoices.filter((choice) =>
        choice.normalized.length >= 2 && normalizedAnswer.includes(choice.normalized)
      );
      if (contained.length) return matchedResult(contained, 0.9);
    }

    let best = null;
    parsedChoices.forEach((choice) => {
      let score = 0;
      if (normalizedAnswer === choice.normalized) score = 0.98;
      if (normalizedAnswer.includes(choice.normalized) || choice.normalized.includes(normalizedAnswer)) {
        score = Math.max(score, 0.9);
      }
      score = Math.max(score, jaccard(normalizedAnswer, choice.normalized));
      if (!best || score > best.score) best = { choice, score };
    });
    return best && best.score >= 0.55
      ? matchedResult([best.choice], best.score)
      : { matched: false, answer: rawAnswer, letters: [], score: best ? best.score : 0 };
  }

  function matchedResult(choices, score) {
    const ordered = choices.slice().sort((a, b) => a.index - b.index);
    return {
      matched: true,
      answer: ordered.map((choice) => choice.letter + ". " + choice.text).join("；"),
      letters: ordered.map((choice) => choice.letter),
      score,
    };
  }

  function extractLetters(answer, validLetters, multiple) {
    const valid = new Set((validLetters || []).map((letter) => String(letter).toUpperCase()));
    const stripped = stripAnswerPrefix(answer).toUpperCase();

    if (multiple) {
      const compact = stripped.match(/^([A-Z]{2,})(?:\s|$|[.。])/);
      if (compact) {
        const compactLetters = compact[1].split("");
        if (compactLetters.every((letter) => valid.has(letter))) return unique(compactLetters);
      }

      const listed = stripped.match(/^([A-Z](?:\s*(?:[,，、;；/|+&#]|和|及|AND)\s*[A-Z])+)(?:\s|$|[.。])/);
      if (listed) {
        const listedLetters = listed[1]
          .replace(/AND|和|及/g, ",")
          .split(/\s*[,，、;；/|+&#]\s*/)
          .filter(Boolean);
        if (listedLetters.every((letter) => valid.has(letter))) return unique(listedLetters);
      }

      const formatted = [];
      const formattedPattern = /(?:^|[;；\n])\s*([A-Z])\s*[.\)、]/g;
      let formattedMatch;
      while ((formattedMatch = formattedPattern.exec(stripped)) !== null) {
        if (valid.has(formattedMatch[1])) formatted.push(formattedMatch[1]);
      }
      if (formatted.length > 1) return unique(formatted);
    }

    const single = stripped.match(/^([A-Z])(?:\s*[.\)、:]|\s*$)/);
    return single && valid.has(single[1]) ? [single[1]] : [];
  }

  function parseOption(option, index) {
    const raw = String(option || "").trim();
    const match = raw.match(/^([A-Za-z])(?:\s*[.\)、]|\s*$)\s*(.*)$/);
    const letter = match ? match[1].toUpperCase() : String.fromCharCode(65 + Number(index || 0));
    const text = match ? (match[2] || "").trim() : raw;
    return { raw, letter, text, normalized: normalize(text), index: Number(index || 0) };
  }

  function stripAnswerPrefix(text) {
    return String(text || "")
      .trim()
      .replace(/^\s*(?:(?:正确)?答案|answers?)\s*(?:是|为|are|is|[:：])?\s*/i, "");
  }

  function normalize(text) {
    return String(text || "")
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
    let intersection = 0;
    for (const item of setA) if (setB.has(item)) intersection++;
    return intersection / new Set([...setA, ...setB]).size;
  }

  function unique(items) {
    return Array.from(new Set(items));
  }

  root.AutoAnswer.AnswerNormalizer = { match, extractLetters, parseOption, normalize };
})();
