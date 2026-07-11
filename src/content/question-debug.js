(function () {
  "use strict";
  const root = typeof self !== "undefined" ? self : window;
  root.AutoAnswer = root.AutoAnswer || {};

  function summarizeQuestion(question) {
    return {
      id: question.id,
      type: question.type,
      adapter: question.adapterName || "",
      confidence: typeof question.confidence === "number" ? Number(question.confidence.toFixed(2)) : 0,
      selector: question.containerSelector || "",
      evidence: question.evidence || [],
      text: String(question.stemText || question.questionText || "").slice(0, 120),
      options: Array.isArray(question.options) ? question.options.length : 0,
    };
  }

  function logExtraction(items) {
    if (!items || !items.length) return;
    try {
      console.log("[答题助手] 结构化识别 " + items.length + " 道题:", items.map((item) => summarizeQuestion(item.question)));
    } catch (_) {}
  }

  root.AutoAnswer.QuestionDebug = {
    summarizeQuestion,
    logExtraction,
  };
})();
