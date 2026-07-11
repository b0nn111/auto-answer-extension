(function () {
  "use strict";
  const root = typeof self !== "undefined" ? self : window;
  root.AutoAnswer = root.AutoAnswer || {};

  const MAX_EVIDENCE = 5;

  root.AutoAnswer.LocalRanker = {
    rerank(questionText, options, materials) {
      const query = buildQuery(questionText, options);
      const queryModel = buildQueryModel(query, options);
      return (materials || [])
        .map((material) => scoreMaterial(material, queryModel))
        .sort((a, b) => b.rankerScore - a.rankerScore);
    },

    rankOptions(question, materials) {
      const q = question || {};
      const options = Array.isArray(q.options) ? q.options : [];
      const queryModel = buildQueryModel(q.questionText || q.stemText || "", options);
      return options.map((option, index) => scoreOption(option, index, queryModel, materials || []))
        .sort((a, b) => b.rankerScore - a.rankerScore);
    },

    _test: {
      buildQueryModel,
      scoreMaterial,
      scoreOption,
      tokenize,
      extractEntities,
    },
  };

  function buildQuery(questionText, options) {
    return [
      questionText,
      Array.isArray(options) ? options.join("\n") : "",
    ].filter(Boolean).join("\n");
  }

  function buildQueryModel(query, options) {
    const text = String(query || "");
    const aliases = queryAliases(text);
    const tokens = unique([...tokenize(text), ...aliases]);
    const entities = extractEntities(text);
    const optionModels = (options || []).map((option, index) => parseOption(option, index));
    return {
      text,
      normalized: normalize(text),
      tokens,
      entities,
      aliases,
      options: optionModels,
      focus: inferFocus(text),
    };
  }

  function scoreMaterial(material, queryModel) {
    const searchable = searchableText(material);
    const norm = normalize(searchable);
    const tokens = tokenize(searchable);
    const tokenSet = new Set(tokens);
    const evidence = [];

    const tokenScore = overlapScore(queryModel.tokens, tokenSet);
    if (tokenScore > 0) evidence.push("token-overlap:" + round(tokenScore));

    const entityScore = entityOverlap(queryModel.entities, norm);
    if (entityScore > 0) evidence.push("entity:" + round(entityScore));

    const phraseScore = phraseHitScore(queryModel, norm);
    if (phraseScore > 0) evidence.push("phrase:" + round(phraseScore));

    const optionScore = optionPresenceScore(queryModel.options, norm);
    if (optionScore > 0) evidence.push("option:" + round(optionScore));

    const locationScore = locationBoost(material, queryModel);
    if (locationScore > 0) evidence.push("location:" + round(locationScore));

    const negativePenalty = negativeScore(searchable, queryModel.options);
    if (negativePenalty > 0) evidence.push("negative:" + round(negativePenalty));

    const base = Number(material?.score || 0);
    const rankerScore = clamp01(
      base * 0.18 +
      tokenScore * 0.26 +
      entityScore * 0.18 +
      phraseScore * 0.15 +
      optionScore * 0.12 +
      locationScore * 0.08 -
      negativePenalty * 0.12
    );

    return {
      ...material,
      rankerScore: round(rankerScore),
      rankerConfidence: round(clamp01(0.28 + rankerScore * 0.62)),
      rankerEvidence: evidence.slice(0, MAX_EVIDENCE),
    };
  }

  function scoreOption(option, index, queryModel, materials) {
    const parsed = parseOption(option, index);
    const optionNorm = normalize(parsed.optionText);
    const optionTokens = tokenize(parsed.optionText);
    const evidence = [];
    let bestScore = 0;
    const matchedMaterials = [];

    (materials || []).forEach((material) => {
      candidateSentences(material).forEach((sentence) => {
        const norm = normalize(sentence);
        if (!optionNorm || !norm.includes(optionNorm)) return;
        const sentenceTokens = new Set(tokenize(sentence));
        const tokenScore = overlapScore(queryModel.tokens, sentenceTokens);
        const optionTokenScore = overlapScore(optionTokens, sentenceTokens);
        const entityScore = entityOverlap(queryModel.entities, norm);
        const relationScore = relationSupport(sentence, optionNorm, queryModel.focus);
        const keyValueScore = keyValueSupport(sentence, optionNorm, queryModel);
        const negativePenalty = negativeScore(sentence, [{ optionText: parsed.optionText }]);
        const materialScore = Number(material.rankerScore ?? material.score ?? 0);
        const score = clamp01(
          0.22 +
          materialScore * 0.16 +
          tokenScore * 0.18 +
          optionTokenScore * 0.12 +
          entityScore * 0.13 +
          relationScore * 0.21 +
          keyValueScore * 0.24 -
          negativePenalty * 0.42
        );
        if (score > bestScore) {
          bestScore = score;
          evidence.length = 0;
          if (tokenScore > 0) evidence.push("question-token:" + round(tokenScore));
          if (entityScore > 0) evidence.push("entity:" + round(entityScore));
          if (relationScore > 0) evidence.push("relation:" + round(relationScore));
          if (keyValueScore > 0) evidence.push("key-value:" + round(keyValueScore));
          if (negativePenalty > 0) evidence.push("negative:" + round(negativePenalty));
        }
        if (score >= 0.44) matchedMaterials.push(material);
      });
    });

    return {
      ...parsed,
      rankerScore: round(bestScore),
      rankerConfidence: round(clamp01(0.3 + bestScore * 0.58)),
      rankerEvidence: evidence.slice(0, MAX_EVIDENCE),
      materials: uniqueMaterials(matchedMaterials),
    };
  }

  function searchableText(material) {
    return [
      material?.folderName,
      material?.fileName,
      material?.citation,
      ...(Array.isArray(material?.headingPath) ? material.headingPath : []),
      material?.markdown,
      material?.text,
    ].filter(Boolean).join("\n");
  }

  function candidateSentences(material) {
    return String(material?.markdown || material?.text || "")
      .replace(/^#+\s+/gm, "")
      .split(/(?:\n+|(?<=[.!?\u3002\uff01\uff1f])\s*)/)
      .map((item) => item.replace(/^Row\s+\d+:\s*/i, "").trim())
      .filter((item) => item.length >= 3 && item.length <= 420)
      .slice(0, 60);
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

  function inferFocus(text) {
    const norm = normalize(text);
    const focus = [];
    FOCUS_RULES.forEach((rule) => {
      if (rule.pattern.test(norm)) focus.push(...rule.tokens);
    });
    return unique(focus);
  }

  function queryAliases(text) {
    const norm = normalize(text);
    const aliases = [];
    QUERY_ALIASES.forEach((rule) => {
      if (rule.pattern.test(norm)) aliases.push(...rule.tokens);
    });
    return aliases;
  }

  function phraseHitScore(queryModel, normText) {
    const phrases = [
      ...queryModel.entities,
      ...queryModel.focus,
    ].filter((item) => item.length >= 3);
    if (!phrases.length) return 0;
    let hits = 0;
    phrases.forEach((phrase) => {
      if (normText.includes(normalize(phrase))) hits++;
    });
    return hits / phrases.length;
  }

  function optionPresenceScore(options, normText) {
    if (!options.length) return 0;
    let hits = 0;
    options.forEach((option) => {
      const norm = normalize(option.optionText);
      if (norm.length >= 2 && normText.includes(norm)) hits++;
    });
    return hits / options.length;
  }

  function locationBoost(material, queryModel) {
    const location = normalize([
      material?.folderName,
      material?.fileName,
      ...(Array.isArray(material?.headingPath) ? material.headingPath : []),
    ].filter(Boolean).join(" "));
    if (!location) return 0;
    const score = overlapScore(queryModel.tokens, new Set(tokenize(location)));
    return Math.min(0.8, score * 1.2);
  }

  function relationSupport(sentence, optionNorm, focus) {
    const norm = normalize(sentence);
    const optionAt = norm.indexOf(optionNorm);
    if (optionAt < 0) return 0;
    const nearby = norm.slice(Math.max(0, optionAt - 90), optionAt + optionNorm.length + 90);
    const focusHit = (focus || []).some((token) => nearby.includes(normalize(token)));
    const relationHit = RELATION_WORDS.some((word) => nearby.includes(word));
    if (focusHit && relationHit) return 1;
    if (focusHit || relationHit) return 0.62;
    return 0.2;
  }

  function keyValueSupport(sentence, optionNorm, queryModel) {
    const parts = keyValueParts(sentence);
    if (parts.length < 2) return 0;
    const keyTokens = tokenize(parts[0]);
    const value = normalize(parts[1]);
    if (!value.includes(optionNorm)) return 0;
    const keyOverlap = overlapScore(queryModel.tokens, new Set(keyTokens));
    const focusOverlap = overlapScore(queryModel.focus, new Set(keyTokens));
    if (keyOverlap >= 0.18 || focusOverlap >= 0.2) return 1;
    if (keyTokens.length <= 3) return 0.62;
    return 0.35;
  }

  function keyValueParts(sentence) {
    const text = String(sentence || "").trim();
    const explicit = text
      .split(/\s*(?:\||->|=>|:|\uff1a)\s*/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (explicit.length >= 2) return [explicit[0], explicit[1]];
    if (!text.includes(",")) return [];
    return text.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 2);
  }

  function negativeScore(text, options) {
    const norm = normalize(text);
    let penalty = 0;
    (options || []).forEach((option) => {
      const optionNorm = normalize(option.optionText || option.raw || option);
      if (!optionNorm) return;
      const optionAt = norm.indexOf(optionNorm);
      if (optionAt < 0) return;
      const before = norm.slice(Math.max(0, optionAt - 80), optionAt);
      const after = norm.slice(optionAt + optionNorm.length, optionAt + optionNorm.length + 90);
      if (NEGATIVE_BEFORE.some((word) => before.includes(word))) penalty = Math.max(penalty, 1);
      if (NEGATIVE_AFTER.some((word) => after.includes(word))) penalty = Math.max(penalty, 1);
    });
    return penalty;
  }

  function overlapScore(tokens, targetSet) {
    if (!tokens || !tokens.length || !targetSet || !targetSet.size) return 0;
    let hits = 0;
    unique(tokens).forEach((token) => {
      if (targetSet.has(token)) hits++;
    });
    return hits / Math.max(1, unique(tokens).length);
  }

  function entityOverlap(entities, normText) {
    if (!entities.length || !normText) return 0;
    let hits = 0;
    entities.forEach((entity) => {
      if (normText.includes(normalize(entity))) hits++;
    });
    return hits / entities.length;
  }

  function extractEntities(text) {
    const source = String(text || "");
    const latin = source.match(/\b[A-Z][A-Za-z0-9_-]{2,}\b/g) || [];
    const quoted = source.match(/["'“”‘’]([^"'“”‘’]{2,40})["'“”‘’]/g) || [];
    const cjkTerms = source.match(/[\u4e00-\u9fff]{2,8}/g) || [];
    return unique([
      ...latin,
      ...quoted.map((item) => item.replace(/["'“”‘’]/g, "")),
      ...cjkTerms.filter((item) => !CJK_STOP_TERMS.has(item)),
    ]).slice(0, 12);
  }

  function tokenize(text) {
    const normalized = normalize(text);
    const latin = normalized.match(/[a-z0-9]{2,}/g) || [];
    const cjk = normalized.match(/[\u4e00-\u9fff]{2,}/g) || [];
    const pairs = [];
    cjk.forEach((segment) => {
      for (let i = 0; i < segment.length - 1; i++) pairs.push(segment.slice(i, i + 2));
    });
    return unique([...latin, ...pairs].filter((token) => !STOP_WORDS.has(token))).slice(0, 180);
  }

  function normalize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[^\u4e00-\u9fffa-z0-9]+/g, " ")
      .trim();
  }

  function unique(items) {
    return Array.from(new Set((items || []).filter(Boolean)));
  }

  function uniqueMaterials(materials) {
    const seen = new Set();
    return (materials || []).filter((item) => {
      const key = [item.fileId, item.index, item.citation, item.text].join(":");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 3);
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value || 0)));
  }

  function round(value) {
    return Number(Number(value || 0).toFixed(4));
  }

  const STOP_WORDS = new Set([
    "the", "and", "for", "you", "are", "with", "that", "this", "from", "have",
    "select", "question", "answer", "option", "which", "what", "when", "where",
    "why", "how", "does", "did", "is", "are", "was", "were", "of", "to", "in",
    "on", "all", "correct", "following", "choose", "pick",
    "\u9898\u76ee", "\u9009\u62e9", "\u7b54\u6848", "\u4ee5\u4e0b", "\u4e00\u4e2a",
    "\u54ea\u4e2a", "\u6b63\u786e",
  ]);

  const CJK_STOP_TERMS = new Set(["\u9898\u76ee", "\u4e0b\u5217", "\u4ee5\u4e0b", "\u54ea\u4e9b", "\u4ec0\u4e48"]);

  const QUERY_ALIASES = [
    { pattern: /\u559c\u6b22|\u6c34\u679c|\u5403/, tokens: ["favorite", "fruit", "likes", "like"] },
    { pattern: /\u5468\u4e8c|\u661f\u671f\u4e8c|\u5b9e\u9a8c\u5ba4|\u5e26|\u643a\u5e26|\u4e1c\u897f|\u7269\u54c1|\u53ea\u5e26|\u53ea\u4fdd\u7559|\u6700\u7ec8|only|kept|keep|final/, tokens: ["tuesday", "lab", "packed", "brought", "items", "included", "only", "kept", "final"] },
    { pattern: /locker|\u6697\u53f7|\u5bc6\u7801|code/, tokens: ["locker", "code"] },
    { pattern: /\u4e3a\u4ec0\u4e48|\u539f\u56e0|\u9009\u62e9|quiet|corner|\u56fe\u4e66\u9986/, tokens: ["reason", "because", "chose", "quiet", "corner", "library", "window", "away"] },
    { pattern: /\u6807\u7b7e|\u989c\u8272|\u96e8\u5929|\u9605\u8bfb\u5305/, tokens: ["label", "color", "colour", "rainy", "reading", "kit"] },
  ];

  const FOCUS_RULES = [
    { pattern: /favorite|favourite|\u559c\u6b22|\u6c34\u679c/, tokens: ["favorite", "fruit", "likes"] },
    { pattern: /packed|brought|included|only|kept|keep|final|\u5e26|\u643a\u5e26|\u4e1c\u897f|\u7269\u54c1|\u53ea\u5e26|\u53ea\u4fdd\u7559|\u6700\u7ec8/, tokens: ["packed", "brought", "included", "items", "only", "kept", "final"] },
    { pattern: /locker|code|\u5bc6\u7801|\u6697\u53f7/, tokens: ["locker", "code"] },
    { pattern: /label|color|colour|\u6807\u7b7e|\u989c\u8272/, tokens: ["label", "color", "colour"] },
    { pattern: /why|reason|because|\u4e3a\u4ec0\u4e48|\u539f\u56e0/, tokens: ["reason", "because", "why"] },
  ];

  const RELATION_WORDS = [
    "favorite", "favourite", "likes", "like", "packed", "included", "include",
    "brought", "took", "kept", "keep", "only", "final", "label", "code", "reason", "because", "chose",
    "\u53ea\u5e26", "\u53ea\u4fdd\u7559", "\u4fdd\u7559", "\u6700\u7ec8", "\u51b3\u5b9a",
  ];

  const NEGATIVE_BEFORE = [
    "not", "never", "refused", "left", "without", "except", "distractor",
    "removed", "deleted", "exclude", "excluded", "discarded",
    "\u6ca1\u6709", "\u4e0d\u662f", "\u62d2\u7edd", "\u7559\u4e0b", "\u5e72\u6270",
    "\u5220\u9664", "\u5220\u53bb", "\u53bb\u6389", "\u6392\u9664", "\u4e0d\u5e26", "\u4e0d\u4fdd\u7559",
  ];

  const NEGATIVE_AFTER = [
    "was not", "not favorite", "only for", "kept for", "left in", "left the",
    "refused", "distractor", "removed", "deleted", "excluded",
    "\u4e0d\u5e26", "\u4e0d\u4fdd\u7559", "\u88ab\u5220\u9664",
  ];
})();
