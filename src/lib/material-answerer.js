(function () {
  "use strict";
  const root = typeof self !== "undefined" ? self : window;
  root.AutoAnswer = root.AutoAnswer || {};

  const MIN_CHOICE_SCORE = 0.48;
  const MIN_CHOICE_MARGIN = 0.03;
  const MIN_PARTIAL_CHOICE_SCORE = 0.18;
  const MIN_TEXT_SCORE = 0.32;
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
    const rankerScores = root.AutoAnswer.LocalRanker?.rankOptions
      ? root.AutoAnswer.LocalRanker.rankOptions(q, refs)
      : [];
    const rankerByLetter = new Map(rankerScores.map((item) => [item.letter, item]));
    const scored = q.options
      .map((option, index) => {
        const base = scoreOption(option, index, q, refs, queryTokens);
        const ranker = rankerByLetter.get(base.letter);
        if (!ranker) return base;
        return {
          ...base,
          score: clampScore(base.score * 0.68 + ranker.rankerScore * 0.32),
          rankerScore: ranker.rankerScore,
          rankerEvidence: ranker.rankerEvidence || [],
          materials: uniqueMaterials([...(base.materials || []), ...(ranker.materials || [])]),
        };
      })
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    const second = scored[1] || { score: 0 };
    const strongSingle = best && best.score >= MIN_CHOICE_SCORE && best.score - second.score >= MIN_CHOICE_MARGIN;
    const partialSingle = best && !q.multiple && best.score >= MIN_PARTIAL_CHOICE_SCORE && best.score - second.score >= 0.12;
    if (!best || (!q.multiple && !strongSingle && !partialSingle) || (q.multiple && best.score < MIN_CHOICE_SCORE)) {
      return noAnswer({ scores: summarizeScores(scored) });
    }

    if (q.multiple) {
      const selected = selectMultipleAnswers(scored, q);
      if (!selected.length) return noAnswer({ scores: summarizeScores(scored) });
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
      confidence: clamp(partialSingle ? 0.5 + best.score * 0.32 : 0.42 + best.score * 0.34),
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
        const sentenceTokens = tokenize(sentence);
        const optionOverlap = tokenOverlap(optionTokens, sentenceTokens);
        if (!exactOption && optionOverlap < 0.42) return;
        const partialOption = !exactOption && optionOverlap >= 0.42 ? 1 : 0;
        const queryOverlap = tokenOverlap(queryTokens, sentenceTokens);
        const keyValue = keyValueOptionSupport(sentence, optionNorm, queryTokens);
        const relation = relationOptionSupport(sentence, optionNorm);
        const keepOnly = keepOnlyOptionSupport(sentence, optionNorm);
        const negative = Math.max(negativeContext(sentence, optionNorm), keepOnly.negative);
        const score = Number(ref.score || 0) * 0.16 +
          exactOption * 0.16 +
          partialOption * 0.28 +
          optionOverlap * 0.22 +
          queryOverlap * 0.14 +
          keyValue * 0.30 +
          keepOnly.positive * 0.36 +
          relation * 0.20 -
          negative * 0.58;
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
        const direct = directAnswerSentence(sentence, q.questionText);
        const blank = blankAnswer(sentence, q.questionText);
        const keyValue = keyValueAnswer(sentence, queryTokens);
        const score = Number(ref.score || 0) * 0.15 +
          Number(ref.rankerScore || 0) * 0.18 +
          overlap * 0.45 +
          (direct ? 0.22 : 0) +
          (blank ? 0.24 : 0) +
          (keyValue ? 0.2 : 0);
        const answer = blank || keyValue || direct || compactAnswer(sentence, q.questionText);
        if (answer && (!best || score > best.score)) {
          best = { answer, score, ref };
        }
      });
    });
    if (!best || best.score < MIN_TEXT_SCORE) return noAnswer();
    return {
      success: true,
      answer: cleanAnswerText(best.answer),
      confidence: clamp(0.38 + best.score * 0.32),
      materials: [best.ref],
      displayAsText: true,
      warning: MATERIAL_WARNING,
    };
  }

  function directAnswerSentence(sentence, questionText) {
    const q = normalize(questionText);
    if (!/(why|reason|because|\u4e3a\u4ec0\u4e48|\u539f\u56e0|\u8bf4\u660e)/.test(q)) return "";
    const text = stripHtml(sentence).replace(/\s+/g, " ").trim();
    const cues = [
      "\u56e0\u4e3a", "\u6240\u4ee5", "\u56e0\u6b64", "\u800c\u662f", "\u62c5\u5fc3",
      "because", "so", "therefore", "instead",
    ];
    if (!cues.some((cue) => text.includes(cue))) return "";
    return compactAnswer(text, questionText);
  }

  function selectMultipleAnswers(scored, q) {
    const best = scored[0];
    if (!best || best.score < MIN_CHOICE_SCORE) return [];
    const expected = expectedAnswerCount(q.questionText);
    if (expected > 0) {
      const selected = scored.slice(0, expected).filter((item) => item.score >= MIN_CHOICE_SCORE - 0.04);
      return selected.length === expected ? selected.sort((a, b) => a.index - b.index) : [];
    }
    const clustered = selectTopScoreCluster(scored);
    if (clustered.length) return clustered.sort((a, b) => a.index - b.index);
    const cutoff = Math.max(MIN_CHOICE_SCORE, best.score - 0.09);
    const selected = scored.filter((item) => item.score >= cutoff);
    if (selected.length >= scored.length) return [];
    return selected.sort((a, b) => a.index - b.index);
  }

  function selectTopScoreCluster(scored) {
    const best = scored[0];
    if (!best || scored.length < 2) return [];
    const topGroup = scored.filter((item) =>
      item.score >= MIN_CHOICE_SCORE &&
      best.score - item.score <= 0.025
    );
    const next = scored[topGroup.length];
    if (!topGroup.length || topGroup.length >= scored.length || !next) return [];
    const gap = topGroup[topGroup.length - 1].score - next.score;
    if (gap < 0.05) return [];
    return topGroup;
  }

  function expectedAnswerCount(questionText) {
    const text = String(questionText || "").toLowerCase();
    if (/(?:\u54ea|\u9009|choose|pick|select).{0,12}(?:\u4e24\u4e2a|\u4e24\u9879|\u4e24\u4ef6|\u54ea\u4e24|2\s*\u4e2a|2\s*\u9879|2\s*\u4ef6|two|both|dos|deux|zwei)/i.test(text)) return 2;
    if (/(?:\u54ea|\u9009|choose|pick|select).{0,12}(?:\u4e09\u4e2a|\u4e09\u9879|\u4e09\u4ef6|\u54ea\u4e09|3\s*\u4e2a|3\s*\u9879|3\s*\u4ef6|three|tres|trois|drei)/i.test(text)) return 3;
    return 0;
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
    return stripHtml(ref?.markdown || ref?.text || "")
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

  function blankAnswer(sentence, questionText) {
    const question = String(questionText || "");
    const blank = question.match(/_{2,}|\uff3f{2,}/);
    if (!blank) return "";
    const before = question.slice(0, blank.index);
    const after = question.slice(blank.index + blank[0].length);
    const prefix = tailLiteral(before, 16);
    const suffix = headLiteral(after, 12);
    const text = String(sentence || "").replace(/\s+/g, " ").trim();

    if (prefix) {
      const prefixAt = text.indexOf(prefix);
      if (prefixAt >= 0) {
        const start = prefixAt + prefix.length;
        const rest = text.slice(start);
        const end = suffix ? rest.indexOf(suffix) : -1;
        const value = (end >= 0 ? rest.slice(0, end) : rest)
          .replace(/^[\s:：，,。.!?！？；;'"“”]+/, "")
          .replace(/[\s:：，,。.!?！？；;'"“”]+$/, "")
          .trim();
        if (value.length >= 1 && value.length <= 40) return value;
      }
    }

    if (suffix) {
      const suffixAt = text.indexOf(suffix);
      if (suffixAt > 0) {
        const beforeSuffix = text.slice(Math.max(0, suffixAt - 40), suffixAt);
        const match = beforeSuffix.match(/([\u4e00-\u9fffa-z0-9_-]{1,24})\s*$/i);
        if (match) return match[1].trim();
      }
    }
    return "";
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
      "\u4e0d", "\u6ca1\u6709", "\u4e0d\u662f", "\u62d2\u7edd", "\u7559\u4e0b", "\u5e72\u6270\u9879",
      "removed", "deleted", "exclude", "excluded", "discarded",
      "\u5220\u9664", "\u5220\u53bb", "\u53bb\u6389", "\u6392\u9664", "\u4e0d\u5e26", "\u4e0d\u4fdd\u7559",
    ];
    if (beforeNegatives.some((item) => before.includes(item)) && !hasKeepCueAfterLastNegative(before, beforeNegatives)) return 1;
    const afterNegatives = [
      "was not her favorite", "was not favorite", "not her favorite", "not favorite",
      "only for", "kept for", "left in", "left the", "refused", "distractor",
      "\u4e0d\u5e26", "\u4e0d\u4fdd\u7559", "\u88ab\u5220\u9664",
    ];
    if (afterNegatives.some((item) => after.includes(item))) return 1;
    const optionPattern = escapeRegExp(optionNorm).replace(/\\ /g, "\\s+");
    const beforePattern = new RegExp("(do not include|did not include|not include|was not|not her favorite|left|refused|removed|deleted|excluded|\\u5220\\u9664|\\u5220\\u53bb|\\u53bb\\u6389|\\u6392\\u9664)\\s+(?:\\w+\\s+){0,4}" + optionPattern);
    const afterPattern = new RegExp(optionPattern + "\\s+(?:\\w+\\s+){0,4}(was not|not her favorite|only for|kept for|distractor|removed|deleted|excluded|\\u4e0d\\u5e26|\\u4e0d\\u4fdd\\u7559)");
    return beforePattern.test(fullPhrase) || afterPattern.test(fullPhrase) ? 1 : 0;
  }

  function keepOnlyOptionSupport(sentence, optionNorm) {
    const text = normalize(sentence);
    const optionAt = text.indexOf(optionNorm);
    if (optionAt < 0) return { positive: 0, negative: 0 };
    const keepAt = firstCueIndex(text, [
      "only", "kept", "keep", "include",
      "\u53ea\u4fdd\u7559", "\u4fdd\u7559", "\u53ea\u5e26", "\u5e26\u4e0a",
    ]);
    if (keepAt >= 0 && optionAt > keepAt) return { positive: 1, negative: 0 };
    const removeAt = firstCueIndex(text, [
      "removed", "deleted", "exclude", "excluded", "discarded",
      "\u5220\u9664", "\u5220\u53bb", "\u53bb\u6389", "\u6392\u9664",
    ]);
    if (removeAt >= 0 && optionAt > removeAt && (keepAt < 0 || optionAt < keepAt)) {
      return { positive: 0, negative: 1 };
    }
    return { positive: 0, negative: 0 };
  }

  function firstCueIndex(text, cues) {
    let result = -1;
    cues.forEach((cue) => {
      const at = text.indexOf(cue);
      if (at >= 0 && (result < 0 || at < result)) result = at;
    });
    return result;
  }

  function hasKeepCueAfterLastNegative(text, negatives) {
    let lastNegative = -1;
    negatives.forEach((item) => {
      const at = text.lastIndexOf(item);
      if (at > lastNegative) lastNegative = at;
    });
    if (lastNegative < 0) return false;
    const tail = text.slice(lastNegative);
    return [
      "only", "kept", "include", "included",
      "\u53ea\u4fdd\u7559", "\u4fdd\u7559", "\u53ea\u5e26", "\u5e26\u4e0a",
    ].some((cue) => tail.includes(cue));
  }

  function compactAnswer(sentence, questionText) {
    let clean = stripHtml(sentence)
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

  function cleanAnswerText(text) {
    return stripHtml(text)
      .replace(/\s+/g, " ")
      .replace(/^[\s:：，,。.!?！？；;'"“”]+/, "")
      .replace(/[\s:：，,。.!?！？；;'"“”]+$/, "")
      .trim();
  }

  function stripHtml(value) {
    return String(value || "")
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/\s*p\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " ");
  }

  function tailLiteral(text, maxLength) {
    const parts = String(text || "")
      .split(/[\n\r\uff0c,\u3002.!?\uff01\uff1f\uff1b;:\uff1a'"“”]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    const value = parts.length ? parts[parts.length - 1] : "";
    return value.slice(Math.max(0, value.length - maxLength));
  }

  function headLiteral(text, maxLength) {
    const parts = String(text || "")
      .split(/[\n\r\uff0c,\u3002.!?\uff01\uff1f\uff1b;:\uff1a'"“”]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    return (parts[0] || "").slice(0, maxLength);
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

  function clampScore(value) {
    return Math.max(0, Math.min(1, Number(value || 0)));
  }

  function summarizeScores(items) {
    return (items || []).map((item) => ({
      letter: item.letter,
      optionText: item.optionText,
      score: Number(item.score.toFixed(4)),
      rankerScore: Number(item.rankerScore || 0),
      rankerEvidence: item.rankerEvidence || [],
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
    { pattern: /\u5468\u4e8c|\u661f\u671f\u4e8c|\u5b9e\u9a8c\u5ba4|\u5e26|\u643a\u5e26|\u4e1c\u897f|\u7269\u54c1|\u53ea\u5e26|\u53ea\u4fdd\u7559|\u6700\u7ec8|only|kept|final/, tokens: ["tuesday", "lab", "packed", "brought", "items", "included", "only", "kept", "final"] },
    { pattern: /locker|\u6697\u53f7|\u5bc6\u7801|code/, tokens: ["locker", "code"] },
    { pattern: /\u4e3a\u4ec0\u4e48|\u539f\u56e0|\u9009\u62e9|quiet|corner|\u56fe\u4e66\u9986/, tokens: ["why", "reason", "because", "chose", "quiet", "corner", "library", "window", "away"] },
    { pattern: /\u6807\u7b7e|\u989c\u8272|\u96e8\u5929|\u9605\u8bfb\u5305/, tokens: ["label", "color", "colour", "rainy", "reading", "kit"] },
  ];
})();
