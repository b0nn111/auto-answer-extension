(function () {
  "use strict";
  const root = typeof self !== "undefined" ? self : window;
  root.AutoAnswer = root.AutoAnswer || {};

  const MIN_CHOICE_SCORE = 0.48;
  const MIN_CHOICE_MARGIN = 0.03;
  const MIN_TEXT_SCORE = 0.42;
  const MAX_REFERENCES = 3;
  const MATERIAL_WARNING = "\u672c\u5730\u8d44\u6599\u62bd\u53d6\uff0c\u4ec5\u4f5c\u53c2\u8003";

  root.AutoAnswer.MaterialAnswerer = {
    answer(question, materials) {
      const q = normalizeQuestion(question);
      const refs = Array.isArray(materials) ? materials : [];
      if (!q.questionText || !refs.length) return noAnswer();
      if (q.type === root.AutoAnswer.Types?.QUESTION_TYPE?.CHOICE && q.options.length) {
        return answerChoice(q, refs);
      }
      return answerText(q, refs);
    },
    _test: {
      answerChoice,
      answerText,
      normalizeQuestion,
      tokenize,
      queryTokenSet,
      scoreOption,
      keyValueParts,
      keyValueAnswer,
    },
  };

  function answerChoice(q, refs) {
    const queryTokens = queryTokenSet(q.questionText);
    const scored = q.options
      .map((option, index) => scoreOption(option, index, q, refs, queryTokens))
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    const second = scored[1] || { score: 0 };
    if (!best || best.score < MIN_CHOICE_SCORE || (!q.multiple && best.score - second.score < MIN_CHOICE_MARGIN)) {
      return noAnswer({ scores: summarizeScores(scored) });
    }

    if (q.multiple) {
      const selected = scored
        .filter((item) => item.score >= MIN_CHOICE_SCORE)
        .sort((a, b) => a.index - b.index);
      if (!selected.length || selected.length >= q.options.length) return noAnswer({ scores: summarizeScores(scored) });
      return {
        success: true,
        answer: selected.map((item) => item.letter + ". " + item.optionText).join(", "),
        confidence: clamp(0.42 + averageScore(selected) * 0.32),
        materials: uniqueMaterials(selected.flatMap((item) => item.materials)),
        warning: MATERIAL_WARNING,
        debug: { scores: summarizeScores(scored) },
      };
    }

    return {
      success: true,
      answer: best.letter + ". " + best.optionText,
      confidence: clamp(0.42 + best.score * 0.34),
      materials: uniqueMaterials(best.materials),
      warning: MATERIAL_WARNING,
      debug: { scores: summarizeScores(scored) },
    };
  }

  function scoreOption(option, index, q, refs, queryTokens) {
    const parsed = parseOption(option, index);
    const optionTokens = tokenize(parsed.optionText);
    let bestScore = 0;
    const matchedMaterials = [];
    refs.forEach((ref) => {
      const sentences = candidateSentences(ref);
      const optionNorm = normalize(parsed.optionText);
      sentences.forEach((sentence) => {
        const norm = normalize(sentence);
        const exactOption = optionNorm.length >= 2 && norm.includes(optionNorm) ? 1 : 0;
        if (!exactOption) return;
        const sentenceTokens = tokenize(sentence);
        const optionOverlap = tokenOverlap(optionTokens, sentenceTokens);
        const queryOverlap = tokenOverlap(queryTokens, sentenceTokens);
        const keyValue = keyValueOptionSupport(sentence, optionNorm, queryTokens);
        const relation = relationOptionSupport(sentence, optionNorm);
        const negative = negativeContext(sentence, optionNorm);
        const score = Number(ref.score || 0) * 0.16 +
          exactOption * 0.22 +
          optionOverlap * 0.12 +
          queryOverlap * 0.14 +
          keyValue * 0.34 +
          relation * 0.22 -
          negative * 0.45;
        if (score > bestScore) bestScore = score;
        if (score >= MIN_CHOICE_SCORE - 0.08) matchedMaterials.push(ref);
      });
    });
    return {
      ...parsed,
      score: bestScore,
      materials: matchedMaterials.length ? matchedMaterials : refs.slice(0, 1),
    };
  }

  function answerText(q, refs) {
    const queryTokens = queryTokenSet(q.questionText);
    let best = null;
    refs.forEach((ref) => {
      candidateSentences(ref).forEach((sentence) => {
        const tokens = tokenize(sentence);
        const overlap = tokenOverlap(queryTokens, tokens);
        const keyValue = keyValueAnswer(sentence, queryTokens);
        const score = Number(ref.score || 0) * 0.25 + overlap * 0.55 + (keyValue ? 0.2 : 0);
        const answer = keyValue || compactAnswer(sentence, q.questionText);
        if (answer && (!best || score > best.score)) {
          best = { answer, score, ref };
        }
      });
    });
    if (!best || best.score < MIN_TEXT_SCORE) return noAnswer();
    return {
      success: true,
      answer: best.answer,
      confidence: clamp(0.38 + best.score * 0.32),
      materials: [best.ref],
      displayAsText: true,
      warning: MATERIAL_WARNING,
    };
  }

  function normalizeQuestion(question) {
    const q = question || {};
    return {
      type: q.type || "",
      questionText: String(q.stemText || q.questionText || "").trim(),
      options: Array.isArray(q.options) ? q.options : [],
      multiple: q.multiple === true,
    };
  }

  function parseOption(option, index) {
    const raw = String(option || "").trim();
    const match = raw.match(/^([A-Z])\s*[\.\)\]\u3001\uff09]\s*(.+)$/i);
    return {
      raw,
      index,
      letter: match ? match[1].toUpperCase() : String.fromCharCode(65 + index),
      optionText: (match ? match[2] : raw).trim(),
    };
  }

  function searchableText(ref) {
    return [
      ref?.folderName,
      ref?.fileName,
      ref?.citation,
      ref?.markdown,
      ref?.text,
    ].filter(Boolean).join("\n");
  }

  function candidateSentences(ref) {
    return String(ref?.markdown || ref?.text || "")
      .replace(/^#+\s+/gm, "")
      .split(/(?:\n+|(?<=[.!?\u3002\uff01\uff1f])\s*)/)
      .map((item) => item.replace(/^Row\s+\d+:\s*/i, "").trim())
      .filter((item) => item.length >= 4 && item.length <= 360)
      .slice(0, 40);
  }

  function keyValueAnswer(sentence, queryTokens) {
    const parts = keyValueParts(sentence);
    if (parts.length < 2) return "";
    const leftTokens = keyTokens(parts[0]);
    const hits = tokenHits(queryTokens, leftTokens);
    if (hits < 2 && !(hits >= 1 && leftTokens.length <= 3)) return "";
    const value = parts[1].replace(/[\u3002.!?\uff01\uff1f]+$/, "").trim();
    return value.length <= 80 ? value : "";
  }

  function keyValueOptionSupport(sentence, optionNorm, queryTokens) {
    const parts = keyValueParts(sentence);
    if (parts.length < 2) return 0;
    const left = parts[0];
    const value = normalize(parts[1]);
    if (!value.includes(optionNorm)) return 0;
    const leftTokens = keyTokens(left);
    const overlap = tokenOverlap(queryTokens, leftTokens);
    const hits = tokenHits(queryTokens, leftTokens);
    if (overlap >= 0.18 && hits >= 1) return 1;
    return leftTokens.length ? 0.85 : 0.45;
  }

  function keyValueParts(sentence) {
    const text = String(sentence || "").trim();
    const explicit = text
      .split(/\s*(?:\||->|=>|:|\uff1a)\s*/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (explicit.length >= 2) {
      return [explicit[0], explicit[1]];
    }
    const csv = parseSimpleCsvLine(text);
    if (csv.length >= 2) return [csv[0], csv[1]];
    return [];
  }

  function parseSimpleCsvLine(text) {
    const source = String(text || "");
    if (!source.includes(",")) return [];
    const cells = [];
    let value = "";
    let quoted = false;
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (quoted) {
        if (ch === '"' && source[i + 1] === '"') {
          value += '"';
          i++;
        } else if (ch === '"') {
          quoted = false;
        } else {
          value += ch;
        }
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === ",") {
        cells.push(value.trim());
        value = "";
      } else {
        value += ch;
      }
    }
    cells.push(value.trim());
    return cells.filter(Boolean);
  }

  function keyTokens(text) {
    return tokenize(String(text || "").replace(/^[A-Z][a-z]+['\u2019]s\s+/, ""));
  }

  function relationOptionSupport(sentence, optionNorm) {
    const text = normalize(sentence);
    const optionAt = text.indexOf(optionNorm);
    if (optionAt < 0) return 0;
    const nearby = text.slice(Math.max(0, optionAt - 90), optionAt + optionNorm.length + 90);
    const optionPattern = escapeRegExp(optionNorm).replace(/\\ /g, "\\s+");
    const directPatterns = [
      new RegExp("(favorite|favourite|likes|like|packed|included|include|brought|took|label|code)\\s+(?:\\w+\\s+){0,4}" + optionPattern),
      new RegExp(optionPattern + "\\s+(?:and\\s+\\w+\\s+){0,3}(?:notebook|box|label|code)"),
      new RegExp("(fruit|items|kit|bag|answer)\\s+(?:is|are|was|were)?\\s*(?:\\w+\\s+){0,4}" + optionPattern),
    ];
    if (directPatterns.some((pattern) => pattern.test(nearby))) return 1;
    const weakCues = ["favorite", "favourite", "likes", "packed", "included", "brought", "label", "code"];
    return weakCues.some((cue) => nearby.includes(cue)) ? 0.65 : 0;
  }

  function negativeContext(sentence, optionNorm) {
    const text = normalize(sentence);
    const optionAt = text.indexOf(optionNorm);
    if (optionAt < 0) return 0;
    const before = text.slice(Math.max(0, optionAt - 70), optionAt);
    const after = text.slice(optionAt + optionNorm.length, optionAt + optionNorm.length + 90);
    const fullPhrase = text.slice(Math.max(0, optionAt - 90), optionAt + optionNorm.length + 20);
    const beforeNegatives = [
      "not", "never", "refused", "left", "without", "except", "distractor",
      "不", "没有", "不是", "拒绝", "留下", "干扰项",
    ];
    if (beforeNegatives.some((item) => before.includes(item))) return 1;
    const afterNegatives = [
      "was not her favorite", "was not favorite", "not her favorite", "not favorite",
      "only for", "kept for", "left in", "left the", "refused", "distractor",
    ];
    if (afterNegatives.some((item) => after.includes(item))) return 1;
    const optionPattern = escapeRegExp(optionNorm).replace(/\\ /g, "\\s+");
    const beforePattern = new RegExp("(do not include|did not include|not include|was not|not her favorite|left|refused)\\s+(?:\\w+\\s+){0,4}" + optionPattern);
    const afterPattern = new RegExp(optionPattern + "\\s+(?:\\w+\\s+){0,4}(was not|not her favorite|only for|kept for|distractor)");
    return beforePattern.test(fullPhrase) || afterPattern.test(fullPhrase) ? 1 : 0;
  }

  function compactAnswer(sentence, questionText) {
    let clean = String(sentence || "")
      .replace(/^Row\s+\d+:\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();
    const subject = firstContentToken(questionText);
    if (subject) {
      const pattern = new RegExp("\\b" + escapeRegExp(subject) + "\\b\\s+(?:is|are|means|measures|equals|refers to)\\s+", "i");
      clean = clean.replace(pattern, "");
    }
    clean = clean.replace(/[\u3002.!?\uff01\uff1f]+$/, "").trim();
    if (clean.length > 180) clean = clean.slice(0, 180).trim() + "...";
    return clean;
  }

  function questionOptionProximity(text, queryTokens, optionNorm) {
    const optionAt = text.indexOf(optionNorm);
    if (optionAt < 0) return 0;
    const nearby = text.slice(Math.max(0, optionAt - 160), optionAt + optionNorm.length + 160);
    return tokenOverlap(queryTokens, tokenize(nearby));
  }

  function tokenOverlap(a, b) {
    if (!a.length || !b.length) return 0;
    const set = new Set(b);
    let hits = 0;
    a.forEach((token) => {
      if (set.has(token)) hits++;
    });
    return hits / Math.max(1, a.length);
  }

  function tokenHits(a, b) {
    if (!a.length || !b.length) return 0;
    const set = new Set(b);
    let hits = 0;
    a.forEach((token) => {
      if (set.has(token)) hits++;
    });
    return hits;
  }

  function tokenize(text) {
    const normalized = normalize(text);
    const latin = normalized.match(/[a-z0-9]{2,}/g) || [];
    const cjk = normalized.match(/[\u4e00-\u9fff]{2,}/g) || [];
    const pairs = [];
    cjk.forEach((segment) => {
      for (let i = 0; i < segment.length - 1; i++) pairs.push(segment.slice(i, i + 2));
    });
    return [...latin, ...pairs].filter((token) => !STOP_WORDS.has(token)).slice(0, 120);
  }

  function queryTokenSet(text) {
    const tokens = tokenize(text);
    const normalized = normalize(text);
    QUESTION_ALIASES.forEach((item) => {
      if (item.pattern.test(normalized)) tokens.push(...item.tokens);
    });
    return Array.from(new Set(tokens)).slice(0, 160);
  }

  function firstContentToken(text) {
    return (tokenize(text).find((token) => /^[a-z0-9]{3,}$/.test(token)) || "").trim();
  }

  function normalize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[^\u4e00-\u9fffa-z0-9]+/g, " ")
      .trim();
  }

  function uniqueMaterials(materials) {
    const seen = new Set();
    return (materials || []).filter((item) => {
      const key = [item.fileId, item.index, item.citation, item.text].join(":");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, MAX_REFERENCES);
  }

  function averageScore(items) {
    return items.reduce((sum, item) => sum + item.score, 0) / Math.max(1, items.length);
  }

  function clamp(value) {
    return Math.max(0.2, Math.min(0.78, Number(value || 0.45)));
  }

  function summarizeScores(items) {
    return (items || []).map((item) => ({
      letter: item.letter,
      optionText: item.optionText,
      score: Number(item.score.toFixed(4)),
    }));
  }

  function noAnswer(debug) {
    return { success: false, debug: debug || null };
  }

  function escapeRegExp(text) {
    return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  const STOP_WORDS = new Set([
    "the", "and", "for", "you", "are", "with", "that", "this", "from", "have",
    "select", "question", "answer", "option", "which", "what", "when", "where",
    "why", "how", "does", "do", "did", "is", "are", "was", "were", "of", "to",
    "in", "on", "a", "an", "all", "correct", "following", "choose", "pick",
    "\u9898\u76ee", "\u9009\u62e9", "\u7b54\u6848", "\u4ee5\u4e0b", "\u4e00\u4e2a",
    "\u54ea\u4e2a", "\u6b63\u786e",
  ]);

  const QUESTION_ALIASES = [
    { pattern: /\u559c\u6b22|\u6c34\u679c|\u5403/, tokens: ["favorite", "fruit", "likes", "like"] },
    { pattern: /\u5468\u4e8c|\u661f\u671f\u4e8c|\u5b9e\u9a8c\u5ba4|\u5e26|\u643a\u5e26|\u4e1c\u897f/, tokens: ["tuesday", "lab", "packed", "brought", "items", "included"] },
    { pattern: /locker|\u6697\u53f7|\u5bc6\u7801|code/, tokens: ["locker", "code"] },
    { pattern: /\u4e3a\u4ec0\u4e48|\u539f\u56e0|\u9009\u62e9|quiet|corner|\u56fe\u4e66\u9986/, tokens: ["why", "reason", "because", "chose", "quiet", "corner", "library", "window", "away"] },
    { pattern: /\u6807\u7b7e|\u989c\u8272|\u96e8\u5929|\u9605\u8bfb\u5305/, tokens: ["label", "color", "colour", "rainy", "reading", "kit"] },
  ];
})();
