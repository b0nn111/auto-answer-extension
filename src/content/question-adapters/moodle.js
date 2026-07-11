(function () {
  "use strict";
  const root = typeof self !== "undefined" ? self : window;
  root.AutoAnswer = root.AutoAnswer || {};
  const N = root.AutoAnswer.QuestionNormalizer;

  const ADAPTER_NAME = "MoodleQuestionAdapter";

  function findCandidates(doc) {
    return N.safeQueryAll(doc, ".que")
      .filter((el) => N.isVisible(el) && !N.isNoiseElement(el))
      .slice(0, 50);
  }

  function extract(container, context) {
    const stemEl = container.querySelector(".qtext");
    const stemText = N.cleanElementText(stemEl || container, [".answer"]).trim();
    if (!stemText || stemText.length < 3) return null;

    const signals = N.detectInputSignals(container);
    const options = (signals.hasRadio || signals.hasCheckbox)
      ? N.extractDomOptions(container)
      : [];

    const evidence = ["container:.que"];
    let score = 5;
    if (stemEl) {
      score += 3;
      evidence.push("stem:.qtext");
    }
    if (signals.hasRadio) {
      score += 2;
      evidence.push("input:radio");
    }
    if (signals.hasCheckbox) {
      score += 2;
      evidence.push("input:checkbox");
    }
    if (signals.hasTextInput) {
      score += 2;
      evidence.push("input:text");
    }
    if (options.length >= 2 && options.length <= 8) {
      score += 3;
      evidence.push("options:" + options.length);
    }
    if (signals.buttonCount > 4) score -= 1;

    const types = root.AutoAnswer.Types?.QUESTION_TYPE || {};
    let type = types.UNKNOWN || "unknown";
    if (signals.hasRadio || signals.hasCheckbox) {
      if (options.length < 2) return null;
      type = types.CHOICE || "choice";
    } else if (signals.hasTextInput) {
      type = types.FILL || "fill";
    } else if (stemText.length > 20) {
      type = types.SHORT_ANSWER || "short_answer";
    } else {
      return null;
    }

    const stableId = container.id || container.querySelector("[id]")?.id || stemText;
    const confidence = Math.max(0.55, Math.min(0.98, score / 12));
    const question = N.buildQuestionBlock(container, {
      id: context.createId(),
      stemText,
      type,
      options,
      multiple: signals.hasCheckbox,
      adapterName: ADAPTER_NAME,
      confidence,
      evidence,
      dedupeKey: "moodle:" + N.normalizeText(stableId).slice(0, 120),
    });
    if (!question) return null;
    return { question, element: container, score, evidence, adapterName: ADAPTER_NAME };
  }

  root.AutoAnswer.QuestionAdapters = root.AutoAnswer.QuestionAdapters || {};
  root.AutoAnswer.QuestionAdapters.MoodleQuestionAdapter = {
    name: ADAPTER_NAME,
    findCandidates,
    extract,
  };
})();
