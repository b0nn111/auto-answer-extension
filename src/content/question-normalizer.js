(function () {
  "use strict";
  const root = typeof self !== "undefined" ? self : window;
  root.AutoAnswer = root.AutoAnswer || {};

  const EXTENSION_SELECTORS = ".aa-badge, .aa-answer-toggle, .aa-answer-body, .aa-ghost-hint";
  const NOISE_SELECTOR = [
    "nav",
    "header",
    "footer",
    "aside",
    "[role=navigation]",
    "[class*=navigation]",
    "[class*=navbar]",
    "[class*=breadcrumb]",
    "[class*=timer]",
    "[id*=timer]",
    "[class*=countdown]",
    "[class*=feedback]",
    "[class*=comment]",
    "[class*=submit]",
    "[class*=pagination]",
    "[class*=drawer]",
    "[class*=sidebar]",
    "[data-region*=drawer]",
    "[data-region*=blocks-column]",
    EXTENSION_SELECTORS,
  ].join(",");

  function normalizeText(text) {
    const matcher = root.AutoAnswer.Matcher;
    if (matcher && typeof matcher.normalizeText === "function") return matcher.normalizeText(text);
    return String(text || "")
      .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
      .replace(/[^\w\u4e00-\u9fff\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function uniqueElements(elements) {
    const seen = new Set();
    const result = [];
    (elements || []).forEach((el) => {
      if (!el || seen.has(el)) return;
      seen.add(el);
      result.push(el);
    });
    return result;
  }

  function safeQueryAll(rootEl, selector) {
    try {
      return Array.from(rootEl.querySelectorAll(selector));
    } catch (_) {
      return [];
    }
  }

  function safeClosest(el, selector) {
    try {
      return el && typeof el.closest === "function" ? el.closest(selector) : null;
    } catch (_) {
      return null;
    }
  }

  function removeNoiseFromClone(clone, extraSelectors) {
    const selectors = [EXTENSION_SELECTORS, "script", "style", "noscript"].concat(extraSelectors || []);
    selectors.forEach((selector) => safeQueryAll(clone, selector).forEach((node) => node.remove()));
  }

  function cleanElementText(element, removeSelectors) {
    if (!element) return "";
    const clone = typeof element.cloneNode === "function" ? element.cloneNode(true) : null;
    const source = clone || element;
    if (clone) removeNoiseFromClone(clone, removeSelectors);
    return String(source.textContent || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t\r\f\v]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\s+\n/g, "\n")
      .trim();
  }

  function isVisible(element) {
    if (!element) return false;
    if (element.hidden || element.getAttribute?.("aria-hidden") === "true") return false;
    const style = element.ownerDocument?.defaultView?.getComputedStyle
      ? element.ownerDocument.defaultView.getComputedStyle(element)
      : null;
    if (style && (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0)) return false;
    const rect = typeof element.getBoundingClientRect === "function" ? element.getBoundingClientRect() : null;
    if (rect && rect.width === 0 && rect.height === 0) return false;
    return true;
  }

  function isNoiseElement(element) {
    if (!element) return true;
    if (safeClosest(element, EXTENSION_SELECTORS)) return true;
    return element.matches?.(NOISE_SELECTOR) || Boolean(safeClosest(element, NOISE_SELECTOR));
  }

  function selectorFor(element) {
    if (!element || !element.tagName) return "";
    if (element.id) return "#" + cssEscape(element.id);
    const parts = [];
    let node = element;
    while (node && node.nodeType === 1 && parts.length < 4) {
      let part = String(node.tagName || "").toLowerCase();
      const className = String(node.className || "").trim().split(/\s+/).filter(Boolean)[0];
      if (className) part += "." + cssEscape(className);
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children || []).filter((child) => child.tagName === node.tagName);
        if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")";
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(" > ");
  }

  function cssEscape(value) {
    if (root.CSS && typeof root.CSS.escape === "function") return root.CSS.escape(value);
    return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function normalizeOptionLetter(text) {
    const match = String(text || "").trim().match(/^([a-z])\s*[\.\)、]/i);
    if (!match) return "";
    const upper = match[1].toUpperCase();
    return /^[A-Z]$/.test(upper) ? upper : "";
  }

  function stripOptionPrefix(text) {
    return String(text || "").replace(/^[a-z]\s*[\.\)、]\s*/i, "").trim();
  }

  function optionFromRow(row, index) {
    const labelEl = row.querySelector?.('[data-region="answer-label"]') || row.querySelector?.("label") || row;
    const rawNumber = cleanElementText(labelEl.querySelector?.(".answernumber") || null);
    let text = cleanElementText(labelEl, [".answernumber"]);
    text = stripOptionPrefix(text);
    if (!text || text.length > 500) return null;
    const letter = normalizeOptionLetter(rawNumber) || normalizeOptionLetter(labelEl.textContent) || String.fromCharCode(65 + index);
    return letter + ". " + text;
  }

  function extractDomOptions(container) {
    const answerRoot = container.querySelector?.(".answer") || container;
    const rows = uniqueElements([
      ...safeQueryAll(answerRoot, ".r0, .r1"),
      ...safeQueryAll(answerRoot, '[data-region="answer-label"]'),
      ...safeQueryAll(answerRoot, "label"),
      ...safeQueryAll(answerRoot, "li"),
      ...safeQueryAll(answerRoot, ".option, .choice, .answer-option"),
    ])
      .map((el) => safeClosest(el, ".r0, .r1, label, li, .option, .choice, .answer-option") || el)
      .filter((el) => el && answerRoot.contains(el))
      .filter((el) =>
        el.querySelector?.('input[type="radio"], input[type="checkbox"]') ||
        el.matches?.('[data-region="answer-label"], label, li, .option, .choice, .answer-option') ||
        el.querySelector?.('[data-region="answer-label"]')
      );

    const result = [];
    const seen = new Set();
    rows.forEach((row) => {
      const option = optionFromRow(row, result.length);
      const key = normalizeText(option);
      if (!option || seen.has(key)) return;
      seen.add(key);
      result.push(option);
    });
    return result;
  }

  function extractTextOptions(text) {
    const result = [];
    const seen = new Set();
    const re = /(?:^|\n|\s)([A-Ha-h])\s*[\.\)、]\s*([^\n]{1,180}?)(?=\s+[A-Ha-h]\s*[\.\)、]|\n|$)/g;
    let match;
    while ((match = re.exec(String(text || ""))) !== null) {
      const optionText = stripOptionPrefix(match[2]).trim();
      if (!optionText || optionText.length < 1 || optionText.length > 200) continue;
      const option = match[1].toUpperCase() + ". " + optionText;
      const key = normalizeText(option);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(option);
    }
    return result;
  }

  function extractStemText(container) {
    const stemEl =
      container.querySelector?.(".qtext") ||
      container.querySelector?.("legend") ||
      container.querySelector?.("[class*=question-text]") ||
      container.querySelector?.("[class*=qtext]") ||
      container.querySelector?.("[data-region*=question]");
    const stemText = cleanElementText(stemEl || container, [".answer", "label", ".option", ".choice"]);
    return stemText || cleanElementText(container);
  }

  function detectInputSignals(container) {
    const hasRadio = container.querySelector?.('input[type="radio"]') !== null;
    const hasCheckbox = container.querySelector?.('input[type="checkbox"]') !== null;
    const hasTextInput = container.querySelector?.('input[type="text"], input[type="number"], textarea') !== null;
    const hasSelect = container.querySelector?.("select") !== null;
    const buttonCount = safeQueryAll(container, "button, input[type=button], input[type=submit]").length;
    return { hasRadio, hasCheckbox, hasTextInput, hasSelect, buttonCount };
  }

  function buildQuestionBlock(container, options) {
    const types = root.AutoAnswer.Types?.QUESTION_TYPE || {};
    const id = options.id;
    const stemText = String(options.stemText || "").trim();
    const questionOptions = Array.isArray(options.options) ? options.options : [];
    let type = options.type || types.UNKNOWN || "unknown";
    if (!type || type === (types.UNKNOWN || "unknown")) {
      if (questionOptions.length >= 2) type = types.CHOICE || "choice";
      else if (options.hasTextInput) type = types.FILL || "fill";
      else if (stemText.length > 20) type = types.SHORT_ANSWER || "short_answer";
    }
    const questionText = type === (types.CHOICE || "choice") && questionOptions.length
      ? [stemText, ...questionOptions].join("\n")
      : stemText;
    if (!questionText || questionText.length < 3) return null;
    return {
      id,
      questionText,
      stemText,
      type,
      options: questionOptions,
      multiple: options.multiple === true,
      dedupeKey: options.dedupeKey || options.adapterName + ":" + normalizeText(questionText).slice(0, 120),
      adapterName: options.adapterName,
      confidence: options.confidence,
      containerSelector: selectorFor(container),
      evidence: options.evidence || [],
    };
  }

  root.AutoAnswer.QuestionNormalizer = {
    EXTENSION_SELECTORS,
    NOISE_SELECTOR,
    normalizeText,
    uniqueElements,
    safeQueryAll,
    safeClosest,
    cleanElementText,
    isVisible,
    isNoiseElement,
    selectorFor,
    normalizeOptionLetter,
    stripOptionPrefix,
    extractDomOptions,
    extractTextOptions,
    extractStemText,
    detectInputSignals,
    buildQuestionBlock,
  };
})();
