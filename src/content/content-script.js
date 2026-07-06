(function () {
  "use strict";
  const root = typeof self !== "undefined" ? self : window;
  const { Types, Matcher, Annotator, Panel } = root.AutoAnswer;
  // ── State ──
  let isActive = false;
  let questionCounter = 0;
  const elementMap = new Map(); // questionId → HTMLElement
  let scanTimer = null;
  let lastScanTime = 0;
  const MIN_SCAN_INTERVAL = 3000; // Don"t scan more than once per 3s
  let scanFailCount = 0;
  const detectedTexts = new Set();
  // ── Init ──
  function init() {
    Panel.create(() => isActive);
    // Read toggle state from storage
    try {
      chrome.storage.sync.get(["extensionEnabled"], (s) => {
        isActive = s.extensionEnabled === true;
        Panel.setActive(isActive);
        if (isActive) {
          // Only schedule scan if enabled
          setTimeout(() => scheduleScan(true), 2000);
        }
      });
    } catch (_) {}
    root.AutoAnswer.content = root.AutoAnswer.content || {};
    root.AutoAnswer.content.retry = scheduleScan;
    // Watch DOM changes, but VERY conservatively
    // Only look for added nodes with question-like class names
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1) {
            const el = node;
            const cls = (el.className || "") + (el.id || "");
            if (/question|quiz|exam|problem/i.test(cls)) {
              scheduleScan();
              return;
            }
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    // Listen for messages from background
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === Types.MSG_TYPE.ANSWERS_RESULT) {
        handleAnswers(msg.answers);
      }
      if (msg.type === Types.MSG_TYPE.PANEL_TOGGLE) {
        isActive = msg.active;
        Panel.setActive(isActive);
        if (isActive) scheduleScan(true);
      }
      if (msg.type === "RETRY_SCAN") {
        retryScan();
      }
    });
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "sync" || !changes.extensionEnabled) return;
        isActive = changes.extensionEnabled.newValue === true;
        Panel.setActive(isActive);
        if (isActive) retryScan();
      });
    } catch (_) {}
    // Also try Chrome"s built-in AI
    tryDetectChromeAI();
  }
  async function tryDetectChromeAI() {
    let hasBuiltin = false;
    try {
      // Chrome Prompt API (Gemini Nano)
      if (typeof ai !== "undefined" && ai.languageModel) {
        hasBuiltin = true;
      }
    } catch (_) {}
    root.AutoAnswer.hasChromeAI = hasBuiltin;
  }
  function scheduleScan(force) {
    clearTimeout(scanTimer);
    const now = Date.now();
    if (!force && now - lastScanTime < MIN_SCAN_INTERVAL) return;
    scanTimer = setTimeout(detectAndSend, 500);
  }
  // ── Detection: targeted only, no broad selectors ──
  function detectAndSend() {
    if (!isActive) return;
    lastScanTime = Date.now();
    const questions = detectQuestions();
    if (questions.length === 0) {
      scanFailCount++;
      if (scanFailCount <= 2) {
        Panel.setStatus("waiting");
        setTimeout(scheduleScan, 3000);
      } else {
        Panel.setStatus("empty");
      }
      return;
    }
    scanFailCount = 0;
    Panel.setStatus("sending", questions.length);
    // Debug: print detected questions to console
    console.log("[答题助手] 检测到 " + questions.length + " 道题:", questions.map(q => ({ id: q.id, text: q.questionText.slice(0, 120), type: q.type, options: q.options })));
    try {
      chrome.runtime.sendMessage(
        { type: Types.MSG_TYPE.DETECT_QUESTIONS, questions },
        (answers) => {
          if (chrome.runtime.lastError) {
            Panel.setStatus("error");
            return;
          }
          if (answers && answers.length) handleAnswers(answers);
        }
      );
    } catch (_) {
      Panel.setStatus("error");
    }
  }
  function detectQuestions() {
    const questions = [];
    const addQ = (q, el) => {
      if (!q) return false;
      if (el.querySelector(".aa-badge")) return false;
      const key = q.dedupeKey || Matcher.normalizeText(q.questionText).slice(0, 120);
      if (detectedTexts.has(key)) return false;
      detectedTexts.add(key);
      elementMap.set(q.id, el);
      questions.push(q);
      return true;
    };

    const moodleQuestions = detectMoodleQuestions();
    for (const item of moodleQuestions) addQ(item.question, item.element);
    if (questions.length > 0) return questions;

    const fieldsets = document.querySelectorAll("fieldset");
    for (let i = 0; i < Math.min(fieldsets.length, 30); i++) {
      const el = fieldsets[i];
      const { signals, score } = Matcher.extractQuestionSignals(el);
      if (score >= 2) addQ(buildQuestion(el, signals), el);
    }
    if (questions.length > 0) return questions;
    // 2. Containers with question-like class/id names
    const classSelectors = [
      "[class*=question]", "[class*=quiz]", "[class*=exam]",
      "[class*=problem]",
      "[id*=question]", "[id*=quiz]",
    ];
    const named = document.querySelectorAll(classSelectors.join(","));
    for (let i = 0; i < Math.min(named.length, 50); i++) {
      const el = named[i];
      const { signals, score } = Matcher.extractQuestionSignals(el);
      if (score >= 2) addQ(buildQuestion(el, signals), el);
    }
    if (questions.length > 0) return questions;
    // 3. Radio/checkbox parents (targeted)
    const radios = document.querySelectorAll("input[type=radio], input[type=checkbox]");
    if (radios.length > 0) {
      const parentSet = new Set();
      radios.forEach((r) => {
        let p = r.closest("fieldset, div, section, li");
        if (p && !parentSet.has(p)) parentSet.add(p);
      });
      parentSet.forEach((el) => {
        if (questions.length >= 20) return;
        const { signals, score } = Matcher.extractQuestionSignals(el);
        if (score >= 3) addQ(buildQuestion(el, signals), el);
      });
    }
    return questions;
  }

  function detectMoodleQuestions() {
    const items = [];
    const containers = document.querySelectorAll(".que");
    for (let i = 0; i < Math.min(containers.length, 50); i++) {
      const el = containers[i];
      const q = buildMoodleQuestion(el);
      if (q) items.push({ question: q, element: el });
    }
    return items;
  }

  function buildMoodleQuestion(container) {
    const stemEl = container.querySelector(".qtext");
    const stemText = cleanElementText(stemEl || container).trim();
    if (!stemText || stemText.length < 3) return null;

    const hasRadio = container.querySelector('input[type="radio"]') !== null;
    const hasCheckbox = container.querySelector('input[type="checkbox"]') !== null;
    const hasTextInput =
      container.querySelector('input[type="text"], input[type="number"], textarea') !== null;

    const id = `q_${++questionCounter}`;
    let type = Types.QUESTION_TYPE.UNKNOWN;
    let options = [];
    let questionText = stemText;

    if (hasRadio || hasCheckbox) {
      type = Types.QUESTION_TYPE.CHOICE;
      options = extractMoodleOptions(container);
      if (options.length < 2) return null;
      questionText = [stemText, ...options].join("\n");
    } else if (hasTextInput) {
      type = Types.QUESTION_TYPE.FILL;
    } else if (stemText.length > 20) {
      type = Types.QUESTION_TYPE.SHORT_ANSWER;
    } else {
      return null;
    }

    const stableId = container.id || container.querySelector("[id]")?.id || questionText;
    return {
      id,
      questionText,
      stemText,
      type,
      options,
      dedupeKey: "moodle:" + Matcher.normalizeText(stableId).slice(0, 120),
    };
  }

  function extractMoodleOptions(container) {
    const answerRoot = container.querySelector(".answer") || container;
    const rows = uniqueElements([
      ...answerRoot.querySelectorAll(".r0, .r1"),
      ...answerRoot.querySelectorAll('[data-region="answer-label"]'),
      ...answerRoot.querySelectorAll("label"),
    ])
      .map((el) => el.closest(".r0, .r1, label") || el)
      .filter((el) => el && answerRoot.contains(el))
      .filter((el) =>
        el.querySelector('input[type="radio"], input[type="checkbox"]') ||
        el.matches('[data-region="answer-label"], label') ||
        el.querySelector('[data-region="answer-label"]')
      );

    const result = [];
    const seen = new Set();
    rows.forEach((row, index) => {
      const labelEl = row.querySelector('[data-region="answer-label"]') || row.querySelector("label") || row;
      const rawNumber = cleanElementText(labelEl.querySelector(".answernumber") || null);
      let text = cleanElementText(labelEl, [".answernumber", ".aa-badge"]);
      text = text.replace(/^[a-z]\s*[\.\)、]\s*/i, "").trim();
      if (!text || text.length > 500) return;
      const letter = normalizeOptionLetter(rawNumber) || normalizeOptionLetter(labelEl.textContent) || String.fromCharCode(65 + result.length);
      const value = `${letter}. ${text}`;
      const key = Matcher.normalizeText(value);
      if (seen.has(key)) return;
      seen.add(key);
      result.push(value);
    });

    return result;
  }

  function normalizeOptionLetter(text) {
    const m = String(text || "").trim().match(/^([a-z])\s*[\.\)、]/i);
    if (!m) return "";
    const upper = m[1].toUpperCase();
    return /^[A-Z]$/.test(upper) ? upper : "";
  }

  function uniqueElements(elements) {
    const result = [];
    const seen = new Set();
    elements.forEach((el) => {
      if (!el || seen.has(el)) return;
      seen.add(el);
      result.push(el);
    });
    return result;
  }

  function cleanElementText(element, removeSelectors) {
    if (!element) return "";
    const clone = element.cloneNode(true);
    const selectors = [".aa-badge", ".aa-answer-toggle", ".aa-answer-body"].concat(removeSelectors || []);
    selectors.forEach((sel) => clone.querySelectorAll(sel).forEach((el) => el.remove()));
    return (clone.textContent || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t\r\f\v]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\s+\n/g, "\n")
      .trim();
  }

  function buildQuestion(element, signals) {
    signals = signals || Matcher.extractQuestionSignals(element);
    let text = (element.textContent || "").trim();
    // If container is fieldset, merge sibling qtext (Moodle separates question text and options)
    if (element.tagName === "FIELDSET") {
      const qtext = element.closest(".formulation")?.querySelector(".qtext");
      if (qtext) {
        const qt = qtext.textContent.trim();
        if (qt && !text.includes(qt.slice(0, 20))) text = qt + "\n" + text;
      }
    }
    if (!text || text.length < 10) return null;
    const id = `q_${++questionCounter}`;
    let type = Types.QUESTION_TYPE.UNKNOWN;
    let options = [];
    if (signals.hasRadio || signals.hasCheckbox) {
      type = Types.QUESTION_TYPE.CHOICE;
      if (text.length < 30) return null;
      // Extract options from text using regex (works regardless of DOM structure)
      const optMap = new Map();
      const optRe = /(?:\b)([A-Da-d])\s*[\.\)、]\s*([^\n]{2,150}?)(?=\s+[A-Da-d]\s*[\.\)、]|\s+[^A-Za-z]|$)/g;
      let m;
      while ((m = optRe.exec(text)) !== null) {
        const val = m[2].trim();
        if (val && val.length > 1 && val.length < 200) optMap.set(val.toLowerCase(), val);
      }
      // Supplement with DOM labels if regex didn't find enough
      if (optMap.size < 2) {
        element.querySelectorAll("label").forEach((lb) => {
          let t = lb.textContent.trim().replace(/^[a-d]\s*[\.\)、]\s*/i, "").trim();
          if (t && t.length > 1 && t.length < 200) optMap.set(t.toLowerCase(), t);
        });
      }
      options = Array.from(optMap.values());
    } else if (signals.hasTextInput) {
      type = Types.QUESTION_TYPE.FILL;
    } else if (text.length > 40) {
      type = Types.QUESTION_TYPE.SHORT_ANSWER;
    }
    return { id, questionText: text, type, options };
  }
  function handleAnswers(results) {
    let choiceCount = 0, fillCount = 0, shortCount = 0, failCount = 0;
    results.forEach((r) => {
      const el = elementMap.get(r.id);
      if (!el) return;
      if (r.source === Types.ANSWER_SOURCE.FAILED) {
        Annotator.markFailed(el, r);
        failCount++;
        return;
      }
      switch (r.type) {
        case Types.QUESTION_TYPE.CHOICE:
          Annotator.annotateChoice(el, r);
          choiceCount++;
          break;
        case Types.QUESTION_TYPE.FILL:
          Annotator.annotateFill(el, r);
          fillCount++;
          break;
        case Types.QUESTION_TYPE.SHORT_ANSWER:
        case Types.QUESTION_TYPE.CODING:
          Annotator.annotateText(el, r);
          shortCount++;
          break;
      }
    });
    Panel.updateStats({ choiceCount, fillCount, shortCount, failCount, total: results.length });
  }
  // ── Public API ──
  root.AutoAnswer.content = root.AutoAnswer.content || {};
  root.AutoAnswer.content.toggle = (active) => {
    isActive = active === true;
    Panel.setActive(isActive);
    try { chrome.storage.sync.set({ extensionEnabled: isActive }); } catch (_) {}
    if (isActive) retryScan();
  };
  root.AutoAnswer.content.retry = retryScan;
  root.AutoAnswer.content.getStats = () => ({
    detected: elementMap.size,
    answered: document.querySelectorAll(".aa-badge").length,
  });

  function retryScan() {
    scanFailCount = 0;
    lastScanTime = 0;
    questionCounter = 0;
    elementMap.clear();
    detectedTexts.clear();
    clearAnnotations();
    scheduleScan(true);
  }

  function clearAnnotations() {
    document.querySelectorAll(".aa-badge, .aa-answer-toggle, .aa-answer-body, .aa-ghost-hint")
      .forEach((el) => el.remove());
    document.querySelectorAll(".aa-highlight-option")
      .forEach((el) => el.classList.remove("aa-highlight-option"));
  }
  // ── Start ──
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

