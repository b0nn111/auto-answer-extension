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
        .map((chunk) => ({ chunk, score: scoreChunk(chunk.text, query, queryTokens) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      return scored.map((item) => ({
        folderId: item.chunk.folderId,
        folderName: item.chunk.folderName,
        fileId: item.chunk.fileId,
        fileName: item.chunk.fileName,
        index: item.chunk.index,
        text: item.chunk.text,
        score: Number(item.score.toFixed(4)),
      }));
    },
  };

  function buildQuery(questionText, options) {
    const optionText = Array.isArray(options) ? options.join("\n") : "";
    return String(questionText || "") + "\n" + optionText;
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
    const cjk = normalized.match(/[\u4e00-\u9fa5]{2,}/g) || [];
    const cjkPairs = [];
    cjk.forEach((segment) => {
      for (let i = 0; i < segment.length - 1; i++) cjkPairs.push(segment.slice(i, i + 2));
    });
    return [...latin, ...cjkPairs]
      .filter((token) => !STOP_WORDS.has(token))
      .slice(0, 160);
  }

  function normalize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[^\u4e00-\u9fa5a-z0-9]+/g, " ")
      .trim();
  }

  const STOP_WORDS = new Set([
    "the", "and", "for", "you", "are", "with", "that", "this", "from", "have",
    "select", "question", "answer", "option", "which", "what", "when", "where",
    "题目", "选择", "答案", "以下", "一个", "哪个",
  ]);
})();
