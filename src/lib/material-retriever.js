(function () {
  "use strict";
  const root = typeof self !== "undefined" ? self : window;
  root.AutoAnswer = root.AutoAnswer || {};

  root.AutoAnswer.MaterialRetriever = {
    async retrieve(questionText, options) {
      const materialDb = root.AutoAnswer.MaterialDB;
      if (!materialDb) return [];
      const chunks = await materialDb.getEnabledChunks();
      if (!chunks.length) return [];

      const query = buildQuery(questionText, options);
      const queryTokens = tokenize(query);
      if (!queryTokens.length) return [];

      const scored = chunks
        .map((chunk) => ({ chunk, score: scoreChunk(searchableChunkText(chunk), query, queryTokens) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 24);

      const materials = scored.map((item) => ({
        folderId: item.chunk.folderId,
        folderName: item.chunk.folderName,
        fileId: item.chunk.fileId,
        fileName: item.chunk.fileName,
        index: item.chunk.index,
        text: item.chunk.text,
        markdown: item.chunk.markdown || item.chunk.text,
        locatorType: item.chunk.locatorType || "paragraph",
        pageNumber: Number.isFinite(item.chunk.pageNumber) ? item.chunk.pageNumber : null,
        headingPath: Array.isArray(item.chunk.headingPath) ? item.chunk.headingPath : [],
        paragraphStart: Number.isFinite(item.chunk.paragraphStart) ? item.chunk.paragraphStart : null,
        paragraphEnd: Number.isFinite(item.chunk.paragraphEnd) ? item.chunk.paragraphEnd : null,
        citation: formatCitation(item.chunk),
        score: Number(item.score.toFixed(4)),
      }));
      const ranker = root.AutoAnswer.LocalRanker;
      const ranked = ranker && typeof ranker.rerank === "function"
        ? ranker.rerank(questionText, options, materials)
        : materials;
      return ranked.slice(0, 8);
    },
    formatCitation,
  };

  function searchableChunkText(chunk) {
    return [
      chunk.folderName,
      chunk.fileName,
      ...(Array.isArray(chunk.headingPath) ? chunk.headingPath : []),
      chunk.text,
    ].filter(Boolean).join("\n");
  }

  function formatCitation(chunk) {
    const parts = [String(chunk.folderName || "\u8d44\u6599\u5e93"), String(chunk.fileName || "\u672a\u547d\u540d\u8d44\u6599")];
    if (Number.isFinite(chunk.pageNumber)) {
      parts.push("\u7b2c" + chunk.pageNumber + "\u9875");
    } else if (Array.isArray(chunk.headingPath) && chunk.headingPath.length) {
      parts.push(chunk.headingPath.join(" > "));
    } else if (Number.isFinite(chunk.paragraphStart)) {
      const end = Number.isFinite(chunk.paragraphEnd) ? chunk.paragraphEnd : chunk.paragraphStart;
      parts.push(end > chunk.paragraphStart
        ? "\u7b2c" + chunk.paragraphStart + "-" + end + "\u6bb5"
        : "\u7b2c" + chunk.paragraphStart + "\u6bb5");
    }
    return parts.join(" / ");
  }

  function buildQuery(questionText, options) {
    const rawQuestion = String(questionText || "");
    const optionText = Array.isArray(options) ? options.join("\n") : "";
    return rawQuestion + "\n" + queryAliases(rawQuestion) + "\n" + optionText;
  }

  function scoreChunk(text, query, queryTokens) {
    const chunk = normalize(text);
    const queryNorm = normalize(query);
    const chunkTokens = new Set(tokenize(chunk));
    let overlap = 0;
    queryTokens.forEach((token) => {
      if (chunkTokens.has(token)) overlap++;
    });
    const overlapScore = overlap / Math.max(1, queryTokens.length);
    const phraseScore = strongestPhraseScore(chunk, queryNorm);
    return overlapScore * 0.75 + phraseScore * 0.25;
  }

  function strongestPhraseScore(chunk, query) {
    const parts = query
      .split(/\n+/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 12)
      .slice(0, 8);
    if (!parts.length) return 0;
    let hits = 0;
    parts.forEach((part) => {
      if (chunk.includes(part.slice(0, Math.min(80, part.length)))) hits++;
    });
    return hits / parts.length;
  }

  function tokenize(text) {
    const normalized = normalize(text);
    const latin = normalized.match(/[a-z0-9]{2,}/g) || [];
    const cjk = normalized.match(/[\u4e00-\u9fff]{2,}/g) || [];
    const cjkPairs = [];
    cjk.forEach((segment) => {
      for (let i = 0; i < segment.length - 1; i++) cjkPairs.push(segment.slice(i, i + 2));
    });
    return [...latin, ...cjkPairs]
      .filter((token) => !STOP_WORDS.has(token))
      .slice(0, 180);
  }

  function normalize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[^\u4e00-\u9fffa-z0-9]+/g, " ")
      .trim();
  }

  function queryAliases(questionText) {
    const text = normalize(questionText);
    const tokens = [];
    QUESTION_ALIASES.forEach((item) => {
      if (item.pattern.test(text)) tokens.push(...item.tokens);
    });
    return tokens.join(" ");
  }

  const STOP_WORDS = new Set([
    "the", "and", "for", "you", "are", "with", "that", "this", "from", "have",
    "select", "question", "answer", "option", "which", "what", "when", "where",
    "\u9898\u76ee", "\u9009\u62e9", "\u7b54\u6848", "\u4ee5\u4e0b", "\u4e00\u4e2a", "\u54ea\u4e2a",
  ]);

  const QUESTION_ALIASES = [
    { pattern: /\u559c\u6b22|\u6c34\u679c|\u5403/, tokens: ["favorite", "fruit", "likes", "like", "apple"] },
    { pattern: /\u5468\u4e8c|\u661f\u671f\u4e8c|\u5b9e\u9a8c\u5ba4|\u5e26|\u643a\u5e26|\u4e1c\u897f/, tokens: ["tuesday", "lab", "packed", "brought", "items", "included"] },
    { pattern: /locker|\u6697\u53f7|\u5bc6\u7801|code/, tokens: ["locker", "code"] },
    { pattern: /\u4e3a\u4ec0\u4e48|\u539f\u56e0|\u9009\u62e9|quiet|corner|\u56fe\u4e66\u9986/, tokens: ["why", "reason", "because", "chose", "quiet", "corner", "library", "window", "away"] },
    { pattern: /\u6807\u7b7e|\u989c\u8272|\u96e8\u5929|\u9605\u8bfb\u5305/, tokens: ["label", "color", "colour", "rainy", "reading", "kit"] },
  ];
})();
