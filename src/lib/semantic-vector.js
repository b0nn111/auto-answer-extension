(function () {
  "use strict";
  const root = typeof self !== "undefined" ? self : window;
  root.AutoAnswer = root.AutoAnswer || {};

  const DIMENSION = 256;
  const VERSION = 1;

  root.AutoAnswer.SemanticVector = {
    VERSION,
    DIMENSION,
    embed,
    score,
    _test: { weightedTerms, tokenize, normalize },
  };

  function embed(text) {
    const vector = new Array(DIMENSION).fill(0);
    weightedTerms(text).forEach((item) => {
      const term = item.term;
      const weight = Number(item.weight || 1);
      const primary = hashTerm(term) % DIMENSION;
      const secondary = hashTerm("b:" + term) % DIMENSION;
      vector[primary] += weight;
      vector[secondary] += weight * 0.35;
    });
    return normalizeVector(vector);
  }

  function score(queryVectorOrText, docVectorOrText) {
    const a = Array.isArray(queryVectorOrText) ? queryVectorOrText : embed(queryVectorOrText);
    const b = Array.isArray(docVectorOrText) ? docVectorOrText : embed(docVectorOrText);
    if (!a.length || !b.length) return 0;
    let dot = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      dot += Number(a[i] || 0) * Number(b[i] || 0);
    }
    return Math.max(0, Math.min(1, dot));
  }

  function weightedTerms(text) {
    const normalized = normalize(text);
    const terms = new Map();
    tokenize(normalized).forEach((term) => addWeighted(terms, term, 1));
    CONCEPTS.forEach((concept) => {
      if (!concept.pattern.test(normalized)) return;
      concept.terms.forEach((term) => addWeighted(terms, term, 1.45));
    });
    return Array.from(terms.entries()).map(([term, weight]) => ({ term, weight }));
  }

  function addWeighted(map, term, weight) {
    const key = String(term || "").trim();
    if (!key || STOP_WORDS.has(key)) return;
    map.set(key, Math.min(3, Number(map.get(key) || 0) + Number(weight || 1)));
  }

  function tokenize(text) {
    const normalized = normalize(text);
    const latin = normalized.match(/[a-z0-9]{2,}/g) || [];
    const cjk = normalized.match(/[\u4e00-\u9fff]{2,}/g) || [];
    const cjkPairs = [];
    cjk.forEach((segment) => {
      for (let i = 0; i < segment.length - 1; i++) cjkPairs.push(segment.slice(i, i + 2));
    });
    return [...latin, ...cjkPairs].filter((token) => !STOP_WORDS.has(token)).slice(0, 240);
  }

  function normalize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
      .replace(/\s+/g, " ")
      .replace(/[^\u4e00-\u9fffa-z0-9]+/g, " ")
      .trim();
  }

  function normalizeVector(vector) {
    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    if (!magnitude) return [];
    return vector.map((value) => Number((value / magnitude).toFixed(5)));
  }

  function hashTerm(term) {
    let hash = 2166136261;
    const text = String(term || "");
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  const STOP_WORDS = new Set([
    "the", "and", "for", "you", "are", "with", "that", "this", "from", "have",
    "what", "which", "when", "where", "why", "how", "does", "did", "was", "were",
    "is", "are", "of", "to", "in", "on", "a", "an", "all", "select", "choose",
    "question", "answer", "option", "correct", "following",
    "\u9898\u76ee", "\u9009\u62e9", "\u7b54\u6848", "\u4ee5\u4e0b", "\u4ec0\u4e48",
    "\u54ea\u4e2a", "\u54ea\u4e9b", "\u4e00\u4e2a", "\u6b63\u786e",
  ]);

  const CONCEPTS = [
    { pattern: /favorite|favourite|likes|like|prefer|\u559c\u6b22|\u504f\u597d/, terms: ["concept:preference", "favorite", "likes"] },
    { pattern: /fruit|apple|banana|peach|pear|grape|\u6c34\u679c|\u82f9\u679c|\u9999\u8549|\u6843|\u68a8|\u8461\u8404/, terms: ["concept:fruit", "fruit"] },
    { pattern: /borrow|borrowed|loan|lent|checkout|checked out|\u501f|\u501f\u8d70|\u501f\u9605/, terms: ["concept:borrow", "borrowed", "loan"] },
    { pattern: /key|locker|code|password|\u94a5\u5319|\u5bc6\u7801|\u6697\u53f7|\u67dc/, terms: ["concept:key-code", "key", "code"] },
    { pattern: /greenhouse|glasshouse|\u6e29\u5ba4|\u73bb\u7483/, terms: ["concept:greenhouse", "greenhouse", "glass"] },
    { pattern: /return|returned|give back|brought back|\u5f52\u8fd8|\u8fd8\u56de|\u9001\u56de/, terms: ["concept:return", "returned"] },
    { pattern: /tape|recording|audio|dock|harbor|pier|\u5f55\u97f3|\u5f55\u97f3\u5e26|\u7801\u5934/, terms: ["concept:recording-dock", "recording", "dock"] },
    { pattern: /rehearsal|practice|friday|\u6392\u7ec3|\u5468\u4e94|\u661f\u671f\u4e94/, terms: ["concept:rehearsal", "rehearsal", "friday"] },
    { pattern: /label|tag|color|colour|crimson|turquoise|gold|violet|\u6807\u7b7e|\u989c\u8272|\u7ea2|\u84dd|\u7eff|\u9752|\u91d1|\u7d2b/, terms: ["concept:label-color", "label", "color"] },
    { pattern: /reason|because|therefore|chose|decided|\u539f\u56e0|\u56e0\u4e3a|\u4e3a\u4ec0\u4e48|\u9009\u62e9|\u51b3\u5b9a/, terms: ["concept:reason", "reason", "because"] },
    { pattern: /quiet|corner|library|window|focus|\u5b89\u9759|\u89d2\u843d|\u56fe\u4e66\u9986|\u7a97|\u4e13\u6ce8/, terms: ["concept:quiet-place", "quiet", "library", "window"] },
    { pattern: /only|kept|keep|final|included|packed|brought|\u53ea\u5e26|\u53ea\u4fdd\u7559|\u4fdd\u7559|\u6700\u7ec8|\u5e26|\u643a\u5e26|\u5305\u542b/, terms: ["concept:kept-items", "only", "kept", "included"] },
    { pattern: /removed|deleted|exclude|excluded|discarded|left|refused|\u5220\u9664|\u5220\u53bb|\u53bb\u6389|\u6392\u9664|\u7559\u4e0b|\u62d2\u7edd/, terms: ["concept:negative", "removed", "excluded"] },
  ];
})();
