(function () {
  "use strict";
  const root = typeof self !== "undefined" ? self : window;
  root.AutoAnswer = root.AutoAnswer || {};
  const { Types } = root.AutoAnswer;

  const STYLE_ID = "aa-styles";

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .aa-badge {
        display: inline-flex; align-items: center; gap: 2px;
        margin-left: 4px; padding: 0 6px; border-radius: 8px;
        font-size: 11px; font-weight: 600; line-height: 18px;
        vertical-align: middle; white-space: nowrap; pointer-events: none;
      }
      .aa-badge--cache { background:#dbeafe; color:#1e40af; border:1px solid #93c5fd; }
      .aa-badge--ollama { background:#fef3c7; color:#92400e; border:1px solid #fcd34d; }
      .aa-badge--deepseek { background:#ede9fe; color:#5b21b6; border:1px solid #c4b5fd; }
      .aa-badge--failed { background:#fee2e2; color:#991b1b; border:1px solid #fca5a5; }
      .aa-ghost-hint {
        position:absolute; font-size:13px; color:#9ca3af; pointer-events:none;
        padding:4px 8px; z-index:9999; background:#f9fafb; border:1px dashed #d1d5db;
        border-radius:4px; max-width:400px; white-space:nowrap;
        overflow:hidden; text-overflow:ellipsis;
      }
      .aa-answer-toggle {
        display:inline-block; margin-top:6px; padding:2px 12px;
        font-size:12px; color:#6366f1; background:#eef2ff;
        border:1px solid #a5b4fc; border-radius:6px; cursor:pointer; user-select:none;
      }
      .aa-answer-toggle:hover { background:#e0e7ff; }
      .aa-answer-body {
        margin-top:4px; padding:8px 12px; font-size:13px; color:#374151;
        background:#f9fafb; border:1px solid #e5e7eb; border-radius:6px;
        line-height:1.5; display:none;
      }
      .aa-answer-body.aa-open { display:block; }
      .aa-highlight-option { outline:2px solid #22c55e; outline-offset:2px; border-radius:4px; background:#f0fdf4; }
    `;
    document.head.appendChild(style);
  }

  // Build badge with answer text: "✅ B 92%"
  function sourceBadge(source, confidence, answerText) {
    const map = {
      cache: { cls: "aa-badge--cache", label: "💾" },
      ollama: { cls: "aa-badge--ollama", label: "💻" },
      ai_api: { cls: "aa-badge--deepseek", label: "🧠" },
    };
    const m = map[source] || map.ollama;
    // Show the answer letter if it's a single character (A/B/C/D)
    const answer = answerText && answerText.length <= 3000 ? " " + answerText.toUpperCase() : "";
    const pct = confidence ? " " + (confidence * 100).toFixed(0) + "%" : "";
    return '<span class="aa-badge ' + m.cls + '">✅' + answer + pct + " " + m.label + "</span>";
  }

  // ── Annotate choice: put ✅ badge after the correct option ──
  function annotateChoice(container, result) {
    injectStyles();
    const answerText = (result.answer || "").trim();
    const answerLower = answerText.toLowerCase();
    const badge = sourceBadge(result.source, result.confidence, answerText);

    // Find all option-like elements inside the container
    const allLabels = container.querySelectorAll("label, .option, .answer, li, span.option-text");

    let matchedEl = null;
    let bestScore = 0;

    allLabels.forEach((el) => {
      const txt = el.textContent.toLowerCase().trim();
      if (!txt || txt.length < 2) return;

      // 1. Direct match: answer letter (A/B/C/D) followed by . or )
      const letterMatch = answerLower.match(/^([a-d])[\s\.\)、]*(.*)$/);
      if (letterMatch) {
        const letter = letterMatch[1];
        const pattern = new RegExp("^\\s*" + letter + "[\\.\\)、]", "i");
        if (pattern.test(txt)) {
          matchedEl = el;
          bestScore = 1.0;
          return;
        }
      }

      // 2. Single letter answer
      if (/^[a-d]$/.test(answerLower)) {
        const pattern = new RegExp("^\\s*" + answerLower + "[\\.\\)、]", "i");
        if (pattern.test(txt)) {
          matchedEl = el;
          bestScore = 1.0;
          return;
        }
      }

      // 3. Simple Jaccard similarity
      const similarity = jaccardSimple(txt, answerLower);
      if (similarity > bestScore) {
        bestScore = similarity;
        matchedEl = el;
      }
    });

    if (matchedEl && bestScore > 0.1) {
      matchedEl.classList.add("aa-highlight-option");
      matchedEl.insertAdjacentHTML("beforeend", badge);
    } else {
      // Fallback: find the first option-like child and append after it
      const firstOpt = container.querySelector("label, .option, .answer, li, input[type=radio], input[type=checkbox]");
      if (firstOpt) {
        // Insert badge after the first option's parent
        const parent = firstOpt.closest("label, div, li") || firstOpt;
        parent.insertAdjacentHTML("beforeend", badge);
      } else {
        container.insertAdjacentHTML("beforeend", badge);
      }
    }
  }

  function annotateFill(container, result) {
    injectStyles();
    const inputs = container.querySelectorAll("input[type=text], textarea");
    if (inputs.length === 0) return;
    const input = inputs[0];
    const rect = input.getBoundingClientRect();
    const hint = document.createElement("div");
    hint.className = "aa-ghost-hint";
    hint.textContent = "✏️ " + (result.answer || "(未识别)");
    hint.style.left = rect.left + "px";
    hint.style.top = rect.top - 28 + "px";
    input.addEventListener("input", () => hint.remove(), { once: true });
    document.body.appendChild(hint);
  }

  function annotateText(container, result) {
    injectStyles();
    const badge = sourceBadge(result.source, result.confidence, result.answer);
    const toggle = document.createElement("div");
    toggle.className = "aa-answer-toggle";
    toggle.textContent = "📖 查看答案";
    const body = document.createElement("div");
    body.className = "aa-answer-body";
    body.textContent = result.answer || "(未识别)";
    toggle.addEventListener("click", () => {
      body.classList.toggle("aa-open");
      toggle.textContent = body.classList.contains("aa-open") ? "📖 收起答案" : "📖 查看答案";
    });
    container.insertAdjacentHTML("beforeend", badge);
    container.appendChild(toggle);
    container.appendChild(body);
  }

  function markFailed(container) {
    injectStyles();
    container.insertAdjacentHTML("beforeend", '<span class="aa-badge aa-badge--failed">❌ 无法解答</span>');
  }

  function jaccardSimple(a, b) {
    const setA = new Set(a.split(""));
    const setB = new Set(b.split(""));
    let inter = 0;
    for (const c of setA) if (setB.has(c)) inter++;
    const union = new Set([...setA, ...setB]).size;
    return union === 0 ? 0 : inter / union;
  }

  root.AutoAnswer.Annotator = { annotateChoice, annotateFill, annotateText, markFailed };
})();




