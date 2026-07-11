(function () {
  "use strict";
  const root = typeof self !== "undefined" ? self : window;
  root.AutoAnswer = root.AutoAnswer || {};
  const N = root.AutoAnswer.QuestionNormalizer;

  const ADAPTER_NAME = "GenericFormQuestionAdapter";

  function findCandidates(doc) {
    const namedSelectors = [
      "fieldset",
      "[class*=question]",
      "[class*=Question]",
      "[class*=quiz]",
      "[class*=Quiz]",
      "[class*=exam]",
      "[class*=problem]",
      "[id*=question]",
      "[id*=Question]",
      "[id*=quiz]",
    ];
    const direct = N.safeQueryAll(doc, namedSelectors.join(",")).slice(0, 100);
    const inputParents = [];
    N.safeQueryAll(doc, "input[type=radio], input[type=checkbox], input[type=text], input[type=number], textarea, select")
      .forEach((input) => {
        const parent = N.safeClosest(input, "fieldset, form, section, article, div, li");
        if (parent) inputParents.push(parent);
      });
    return N.uniqueElements([...direct, ...inputParents])
      .filter((el) => N.isVisible(el) && !N.isNoiseElement(el))
      .slice(0, 120);
  }

  function extract(container, context) {
    const fullText = N.cleanElementText(container);
    if (!fullText || fullText.length < 8) return null;
    const signals = N.detectInputSignals(container);
    const classId = String(container.className || "") + " " + String(container.id || "");
    const hasClassSignal = /question|quiz|exam|problem|choice|answer/i.test(classId);
    const hasKeyword = /[题问]|question|problem|exercise|quiz|what|which|who|how|why|where|when|choose|select|identify|explain|describe|define|calculate|find|solve|determine|list|name|give|state|complete|fill/i.test(fullText);
    const hasNumber = /(?:^|\s)(?:\d+[\.\)、]|[\(（]\d+[\)）]|Question\s*\d+|Q\.?\s*\d+|第\s*\d+\s*[题问])/i.test(fullText);
    const hasLegend = container.querySelector?.("legend") !== null;
    const options = (signals.hasRadio || signals.hasCheckbox || signals.hasSelect)
      ? mergeOptions(N.extractDomOptions(container), N.extractTextOptions(fullText))
      : N.extractTextOptions(fullText);

    const evidence = [];
    let score = 0;
    if (hasClassSignal) {
      score += 2;
      evidence.push("class-or-id");
    }
    if (hasKeyword) {
      score += 2;
      evidence.push("keyword");
    }
    if (hasNumber) {
      score += 2;
      evidence.push("numbered");
    }
    if (hasLegend) {
      score += 2;
      evidence.push("legend");
    }
    if (signals.hasRadio) {
      score += 3;
      evidence.push("input:radio");
    }
    if (signals.hasCheckbox) {
      score += 3;
      evidence.push("input:checkbox");
    }
    if (signals.hasTextInput) {
      score += 2;
      evidence.push("input:text");
    }
    if (signals.hasSelect) {
      score += 2;
      evidence.push("input:select");
    }
    if (options.length >= 2 && options.length <= 8) {
      score += 3;
      evidence.push("options:" + options.length);
    }
    if (fullText.length >= 20 && fullText.length <= 800) score += 1;
    if (fullText.length > 1600) {
      score -= 4;
      evidence.push("too-large");
    }
    if (signals.buttonCount > 5) {
      score -= 2;
      evidence.push("button-heavy");
    }

    const types = root.AutoAnswer.Types?.QUESTION_TYPE || {};
    let type = types.UNKNOWN || "unknown";
    if (signals.hasRadio || signals.hasCheckbox || options.length >= 2) {
      if (options.length < 2) return null;
      type = types.CHOICE || "choice";
    } else if (signals.hasTextInput) {
      type = types.FILL || "fill";
    } else if (score >= 5 && fullText.length > 30) {
      type = types.SHORT_ANSWER || "short_answer";
    } else {
      return null;
    }

    const threshold = type === (types.SHORT_ANSWER || "short_answer") ? 6 : 5;
    if (score < threshold) return null;

    const stemText = N.extractStemText(container);
    const confidence = Math.max(0.35, Math.min(0.92, score / 12));
    const question = N.buildQuestionBlock(container, {
      id: context.createId(),
      stemText,
      type,
      options,
      multiple: signals.hasCheckbox,
      adapterName: ADAPTER_NAME,
      confidence,
      evidence,
    });
    if (!question) return null;
    return { question, element: container, score, evidence, adapterName: ADAPTER_NAME };
  }

  function mergeOptions(primary, secondary) {
    const seen = new Set();
    const result = [];
    [primary || [], secondary || []].forEach((list) => {
      list.forEach((item) => {
        const key = N.normalizeText(item);
        if (!item || seen.has(key)) return;
        seen.add(key);
        result.push(item);
      });
    });
    return result;
  }

  root.AutoAnswer.QuestionAdapters = root.AutoAnswer.QuestionAdapters || {};
  root.AutoAnswer.QuestionAdapters.GenericFormQuestionAdapter = {
    name: ADAPTER_NAME,
    findCandidates,
    extract,
  };
})();
