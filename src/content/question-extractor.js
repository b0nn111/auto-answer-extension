(function () {
  "use strict";
  const root = typeof self !== "undefined" ? self : window;
  root.AutoAnswer = root.AutoAnswer || {};

  function getAdapters() {
    const adapters = root.AutoAnswer.QuestionAdapters || {};
    return [
      adapters.MoodleQuestionAdapter,
      adapters.GenericFormQuestionAdapter,
    ].filter(Boolean);
  }

  function extract(options) {
    const doc = options?.document || document;
    const createId = typeof options?.createId === "function" ? options.createId : defaultCreateId;
    const context = { createId };
    const candidates = [];

    getAdapters().forEach((adapter) => {
      let elements = [];
      try {
        elements = adapter.findCandidates(doc) || [];
      } catch (_) {
        elements = [];
      }
      elements.forEach((element) => {
        try {
          const item = adapter.extract(element, context);
          if (item && item.question && item.element) candidates.push(item);
        } catch (err) {
          if (root.AutoAnswer.QuestionDebug) {
            console.warn("[答题助手] 题目识别 adapter 异常:", adapter.name, err);
          }
        }
      });
    });

    return dedupeCandidates(candidates)
      .sort((a, b) => getDocumentOrder(a.element, b.element))
      .slice(0, 50);
  }

  let fallbackCounter = 0;
  function defaultCreateId() {
    fallbackCounter++;
    return "q_" + fallbackCounter;
  }

  function dedupeCandidates(candidates) {
    const ordered = candidates
      .filter((item) => item.question && item.element)
      .sort((a, b) => (b.score || 0) - (a.score || 0));
    const selected = [];
    const seenKeys = new Set();
    ordered.forEach((item) => {
      const key = item.question.dedupeKey || item.question.questionText;
      if (seenKeys.has(key)) return;
      if (selected.some((chosen) => overlaps(item.element, chosen.element))) return;
      seenKeys.add(key);
      selected.push(item);
    });
    return selected;
  }

  function overlaps(a, b) {
    if (!a || !b || a === b) return a === b;
    if (typeof a.contains === "function" && a.contains(b)) return true;
    if (typeof b.contains === "function" && b.contains(a)) return true;
    return false;
  }

  function getDocumentOrder(a, b) {
    if (!a || !b || typeof a.compareDocumentPosition !== "function") return 0;
    const position = a.compareDocumentPosition(b);
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    return 0;
  }

  root.AutoAnswer.QuestionExtractor = {
    extract,
    dedupeCandidates,
  };
})();
