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
        if (isActive) {
          // Only schedule scan if enabled
          setTimeout(scheduleScan, 2000);
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
        if (isActive) scheduleScan();
      }
      if (msg.type === "RETRY_SCAN") {
        scanFailCount = 0;
        scheduleScan();
      }
    });
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
  function scheduleScan() {
    clearTimeout(scanTimer);
    const now = Date.now();
    if (now - lastScanTime < MIN_SCAN_INTERVAL) return;
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
      const key = Matcher.normalizeText(q.questionText).slice(0, 80);
      if (detectedTexts.has(key)) return false;
      detectedTexts.add(key);
      elementMap.set(q.id, el);
      questions.push(q);
      return true;
    };
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
        Annotator.markFailed(el);
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
  root.AutoAnswer.content.toggle = (active) => { isActive = active; if (active) scheduleScan(); };
  root.AutoAnswer.content.retry = () => { scanFailCount = 0; scheduleScan(); };
  root.AutoAnswer.content.getStats = () => ({
    detected: elementMap.size,
    answered: document.querySelectorAll(".aa-badge").length,
  });
  // ── Start ──
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

