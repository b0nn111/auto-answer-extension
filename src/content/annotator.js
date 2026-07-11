(function () {
  "use strict";
  const root = typeof self !== "undefined" ? self : window;
  root.AutoAnswer = root.AutoAnswer || {};
  const { Types, AnswerNormalizer } = root.AutoAnswer;

  const STYLE_ID = "aa-styles";

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .aa-badge {
        display: inline-block; max-width: calc(100% - 8px);
        margin-left: 4px; padding: 3px 7px; border-radius: 6px;
        font-size: 11px; font-weight: 600; line-height: 1.45;
        vertical-align: middle; white-space: normal; overflow-wrap: anywhere;
        word-break: break-word; pointer-events: none;
      }
      .aa-badge--cache { background:#dbeafe; color:#1e40af; border:1px solid #93c5fd; }
      .aa-badge--material { background:#ecfdf3; color:#067647; border:1px solid #75e0a7; }
      .aa-badge--material-ai { background:#f0f9ff; color:#026aa2; border:1px solid #7cd4fd; }
      .aa-badge--free-search { background:#dcfce7; color:#166534; border:1px solid #86efac; }
      .aa-badge--ollama { background:#fef3c7; color:#92400e; border:1px solid #fcd34d; }
      .aa-badge--deepseek { background:#ede9fe; color:#5b21b6; border:1px solid #c4b5fd; }
      .aa-badge--failed { background:#fee2e2; color:#991b1b; border:1px solid #fca5a5; }
      .aa-stem-tip {
        display:inline-flex; align-items:center; justify-content:center;
        margin-left:6px; width:20px; height:20px; border-radius:10px;
        font-size:12px; color:#475569; background:#f8fafc; border:1px solid #cbd5e1;
        cursor:help; position:relative; vertical-align:middle;
      }
      .aa-stem-tip:hover::after {
        content:attr(data-stem); position:absolute; left:0; top:24px; z-index:2147483647;
        width:min(520px, 70vw); padding:10px 12px; border-radius:8px;
        background:#111827; color:white; font-size:12px; line-height:1.5;
        box-shadow:0 8px 24px rgba(0,0,0,0.18); white-space:pre-wrap;
      }
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
      .aa-candidate { padding:6px 0; border-top:1px solid #e5e7eb; }
      .aa-candidate:first-child { border-top:0; padding-top:0; }
      .aa-candidate-source { font-weight:700; color:#374151; }
      .aa-candidate-meta { color:#64748b; font-size:12px; margin-left:4px; }
      .aa-candidate-answer { margin-top:2px; white-space:pre-wrap; }
      .aa-reference-note {
        margin-top:6px; padding:8px 10px; font-size:13px; color:#334155;
        background:#f8fafc; border:1px solid #cbd5e1; border-radius:6px;
        line-height:1.5;
      }
      .aa-reference-list { margin-top:6px; display:grid; gap:6px; }
      .aa-reference-item {
        padding:7px 9px; background:#ffffff; border:1px solid #e2e8f0;
        border-radius:6px;
      }
      .aa-reference-citation { font-weight:700; color:#0f172a; overflow-wrap:anywhere; }
      .aa-reference-excerpt {
        margin-top:3px; color:#475569; white-space:pre-wrap; overflow-wrap:anywhere;
      }
      .aa-reference-details { margin-top:6px; color:#334155; }
      .aa-reference-details summary { cursor:pointer; color:#475569; font-size:12px; }
      .aa-highlight-option { outline:2px solid #22c55e; outline-offset:2px; border-radius:4px; background:#f0fdf4; }
    `;
    document.head.appendChild(style);
  }

  // Build badge with answer text: "✅ B 92%"
  function sourceBadge(source, confidence, answerText) {
    const map = {
      cache: { cls: "aa-badge--cache", label: "💾", prefix: "✅" },
      material: { cls: "aa-badge--material", label: "📚", prefix: "参考" },
      material_ai: { cls: "aa-badge--material-ai", label: "📚+AI", prefix: "✅" },
      free_search: { cls: "aa-badge--free-search", label: "🔎", prefix: "✅" },
      ollama: { cls: "aa-badge--ollama", label: "💻", prefix: "✅" },
      ai_api: { cls: "aa-badge--deepseek", label: "🧠", prefix: "✅" },
    };
    const m = map[source] || map.ollama;
    const answer = escapeHtml(formatAnswerForBadge(answerText));
    const pct = confidence ? " " + (confidence * 100).toFixed(0) + "%" : "";
    return '<span class="aa-badge ' + m.cls + '">' + m.prefix + answer + pct + " " + m.label + "</span>";
  }

  // ── Annotate choice: put ✅ badge after the correct option ──
  function annotateChoice(container, result) {
    injectStyles();
    if (result.displayAsText) {
      annotateText(container, result);
      return;
    }
    const answerText = (result.answer || "").trim();
    const badge = sourceBadge(result.source, result.confidence, answerText) + stemTip(result);

    const candidates = getChoiceCandidates(container);
    const validLetters = candidates.map((candidate) => candidate.letter).filter(Boolean);
    const optionLetters = Array.isArray(result.optionLetters) && result.optionLetters.length
      ? result.optionLetters
      : AnswerNormalizer.extractLetters(answerText, validLetters, result.multiple === true);
    let matchedCandidates = optionLetters.length
      ? candidates.filter((candidate) => optionLetters.includes(candidate.letter))
      : [];
    if (optionLetters.length && matchedCandidates.length !== optionLetters.length) {
      matchedCandidates = [];
    }

    if (!optionLetters.length && !matchedCandidates.length) {
      const answer = parseAnswer(answerText);
      const compareText = (answer.optionText || answer.raw).toLowerCase();
      let best = null;
      candidates.forEach((candidate) => {
        const similarity = jaccardSimple(candidate.optionText.toLowerCase(), compareText);
        if (!best || similarity > best.score) best = { candidate, score: similarity };
      });
      if (best && best.score > 0.1) matchedCandidates = [best.candidate];
    }

    if (matchedCandidates.length) {
      matchedCandidates.forEach((candidate) => candidate.element.classList.add("aa-highlight-option"));
      const badgeTarget = getBadgeTarget(matchedCandidates[0].element);
      badgeTarget.insertAdjacentHTML("beforeend", badge);
      appendCandidateToggle(container, result);
    } else {
      // Keep an unmatched answer at question level so it cannot imply the first option is correct.
      container.insertAdjacentHTML("beforeend", badge);
      appendCandidateToggle(container, result);
    }
  }

  function getChoiceCandidates(container) {
    const moodleRows = Array.from(container.querySelectorAll(".answer .r0, .answer .r1"));
    const rows = moodleRows.length
      ? moodleRows
      : Array.from(container.querySelectorAll("label, .option, li, span.option-text"));

    const seen = new Set();
    const candidates = [];
    rows.forEach((row) => {
      if (!row || seen.has(row)) return;
      seen.add(row);
      const labelEl = row.querySelector('[data-region="answer-label"]') || row;
      const numberText = cleanText(labelEl.querySelector(".answernumber"));
      const letter = parseOptionLetter(numberText) || parseOptionLetter(labelEl.textContent) || String.fromCharCode(65 + candidates.length);
      let optionText = cleanText(labelEl, [".answernumber", ".aa-badge"]);
      optionText = optionText.replace(/^[a-z]\s*[\.\)、]\s*/i, "").trim();
      const fullText = cleanText(row, [".aa-badge"]);
      if (!optionText || optionText.length < 1) return;
      candidates.push({ element: row, letter, optionText, text: fullText || optionText });
    });
    return candidates;
  }

  function getBadgeTarget(row) {
    return row.querySelector(".flex-fill") ||
      row.querySelector('[data-region="answer-label"]') ||
      row;
  }

  function parseAnswer(text) {
    const raw = String(text || "").trim();
    const match = raw.match(/^([a-z])\s*[\.\)、]?\s*(.*)$/i);
    const letter = match && /^[a-z]$/i.test(match[1]) ? match[1].toUpperCase() : "";
    const optionText = letter ? (match[2] || "").trim() : raw;
    return { raw, letter, optionText };
  }

  function parseOptionLetter(text) {
    const match = String(text || "").trim().match(/^([a-z])\s*[\.\)、]/i);
    return match ? match[1].toUpperCase() : "";
  }

  function cleanText(element, removeSelectors) {
    if (!element) return "";
    const clone = element.cloneNode(true);
    (removeSelectors || []).forEach((selector) => clone.querySelectorAll(selector).forEach((el) => el.remove()));
    return (clone.textContent || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function formatAnswerForBadge(answerText) {
    const text = String(answerText || "").trim();
    if (!text) return "";
    const match = text.match(/^([a-z])(\s*[\.\)、]?.*)$/i);
    if (match && /^[a-z]$/i.test(match[1])) return " " + match[1].toUpperCase() + match[2];
    return " " + text;
  }

  function annotateFill(container, result) {
    injectStyles();
    const inputs = container.querySelectorAll('input[type="text"], input[type="number"], textarea');
    if (inputs.length === 0) {
      annotateText(container, result);
      return;
    }
    const input = inputs[0];
    const wrap = document.createElement("div");
    wrap.className = "aa-answer-body aa-open";
    wrap.innerHTML = '<strong>填空参考答案：</strong> ' + escapeHtml(result.answer || "(未识别)") + " " +
      sourceBadge(result.source, result.confidence, result.answer) + stemTip(result);
    input.insertAdjacentElement("afterend", wrap);
    appendCandidateToggle(container, result);
  }

  function annotateText(container, result) {
    injectStyles();
    const badge = sourceBadge(result.source, result.confidence, result.answer) + stemTip(result);
    const toggle = document.createElement("div");
    toggle.className = "aa-answer-toggle";
    toggle.textContent = result.candidates && result.candidates.length > 1 ? "📖 查看其他答案" : "📖 查看答案";
    const body = document.createElement("div");
    body.className = "aa-answer-body";
    body.innerHTML = renderCandidateList(result);
    toggle.addEventListener("click", () => {
      body.classList.toggle("aa-open");
      toggle.textContent = body.classList.contains("aa-open")
        ? "📖 收起答案"
        : (result.candidates && result.candidates.length > 1 ? "📖 查看其他答案" : "📖 查看答案");
    });
    container.insertAdjacentHTML("beforeend", badge);
    container.appendChild(toggle);
    container.appendChild(body);
  }

  function annotateReferenceOnly(container, result) {
    injectStyles();
    const materials = Array.isArray(result.materials) ? result.materials : [];
    const note = document.createElement("div");
    note.className = "aa-reference-note";
    note.innerHTML = '<strong>' + t("localReferences") + '</strong>' + stemTip(result) +
      '<div class="aa-reference-list">' + renderReferenceItems(materials) + '</div>';
    container.appendChild(note);
  }

  function markFailed(container, result) {
    injectStyles();
    const reason = formatFailedReason(result);
    container.insertAdjacentHTML("beforeend", '<span class="aa-badge aa-badge--failed">❌ ' + escapeHtml(reason) + "</span>");
  }

  function appendCandidateToggle(container, result) {
    const hasAlternatives = result.candidates && result.candidates.length > 1;
    const hasReferences = Array.isArray(result.materials) && result.materials.length > 0;
    if (!hasAlternatives && !hasReferences) return;
    const toggle = document.createElement("div");
    toggle.className = "aa-answer-toggle";
    toggle.textContent = hasAlternatives ? "📖 查看其他答案" : "📚 查看资料引用";
    const body = document.createElement("div");
    body.className = "aa-answer-body";
    body.innerHTML = renderCandidateList(result);
    toggle.addEventListener("click", () => {
      body.classList.toggle("aa-open");
      if (body.classList.contains("aa-open")) {
        toggle.textContent = hasAlternatives ? "📖 收起答案" : "📚 收起引用";
      } else {
        toggle.textContent = hasAlternatives ? "📖 查看其他答案" : "📚 查看资料引用";
      }
    });
    container.appendChild(toggle);
    container.appendChild(body);
  }

  function renderCandidateList(result) {
    const candidates = result.candidates && result.candidates.length
      ? result.candidates
      : [{ answer: result.answer, source: result.source, sourceLabel: sourceLabel(result.source), confidence: result.confidence, warning: result.warning, materials: result.materials }];
    return candidates.map((item, index) => {
      const title = (index === 0 ? "最佳 · " : "") + (item.sourceLabel || sourceLabel(item.source));
      const pct = typeof item.confidence === "number" ? Math.round(item.confidence * 100) + "%" : "";
      const agreement = item.consensusCount > 1 ? " · " + item.consensusCount + " 个来源一致" : "";
      const warning = item.warning ? " · " + item.warning : "";
      const references = renderMaterialsDetails(item.materials);
      return '<div class="aa-candidate">' +
        '<div><span class="aa-candidate-source">' + escapeHtml(title) + '</span>' +
        '<span class="aa-candidate-meta">' + escapeHtml(pct + agreement + warning) + '</span></div>' +
        '<div class="aa-candidate-answer">' + escapeHtml(item.answer || "(空)") + '</div>' +
        references +
        '</div>';
    }).join("");
  }

  function renderMaterialsDetails(materials) {
    if (!Array.isArray(materials) || !materials.length) return "";
    return '<details class="aa-reference-details">' +
      '<summary>' + escapeHtml(t("showReferences")) + '</summary>' +
      '<div class="aa-reference-list">' + renderReferenceItems(materials) + '</div>' +
      '</details>';
  }

  function renderReferenceItems(materials) {
    if (!materials.length) {
      return '<div class="aa-reference-item">' + escapeHtml(t("noReferenceExcerpt")) + '</div>';
    }
    return materials.slice(0, 5).map((item) => {
      const citation = item.citation || buildCitation(item);
      const excerpt = makeExcerpt(item.markdown || item.text || "");
      return '<div class="aa-reference-item">' +
        '<div class="aa-reference-citation">' + escapeHtml(citation) + '</div>' +
        '<div class="aa-reference-excerpt">' + escapeHtml(excerpt || t("noReferenceExcerpt")) + '</div>' +
        '</div>';
    }).join("");
  }

  function buildCitation(item) {
    const parts = [
      item.folderName || t("materialLibrary"),
      item.fileName || t("unnamedMaterial"),
    ];
    if (Number.isFinite(item.pageNumber)) {
      parts.push(t("pagePrefix") + item.pageNumber + t("pageSuffix"));
    } else if (Array.isArray(item.headingPath) && item.headingPath.length) {
      parts.push(item.headingPath.join(" > "));
    } else if (Number.isFinite(item.paragraphStart)) {
      const end = Number.isFinite(item.paragraphEnd) ? item.paragraphEnd : item.paragraphStart;
      parts.push(end > item.paragraphStart
        ? t("paragraphPrefix") + item.paragraphStart + "-" + end + t("paragraphSuffix")
        : t("paragraphPrefix") + item.paragraphStart + t("paragraphSuffix"));
    }
    return parts.join(" / ");
  }

  function makeExcerpt(text) {
    const clean = String(text || "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/[*_~`>|]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return clean.length > 220 ? clean.slice(0, 220) + "..." : clean;
  }

  function stemTip(result) {
    const stem = String(result.questionStem || "").trim();
    if (!stem) return "";
    return '<span class="aa-stem-tip" data-stem="' + escapeHtml(stem) + '" title="悬停查看原题题干">题</span>';
  }

  function formatFailedReason(result) {
    const error = String(result?.error || "").trim();
    if (error.includes("公开接口") || error.includes("免费搜题")) return error;
    if (result?.sourceName) return result.sourceName + "未命中";
    return "无法解答";
  }

  function escapeHtml(text) {
    return String(text || "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  function sourceLabel(source) {
    return {
      cache: "本地题库",
      material: "本地资料参考",
      material_ai: "资料库+AI",
      free_search: "公共搜题",
      ollama: "本地 AI",
      ai_api: "AI API",
    }[source] || source || "未知来源";
  }

  function t(key) {
    return {
      localReferences: "\u672c\u5730\u8d44\u6599\u53ef\u80fd\u76f8\u5173\uff0c\u4ec5\u4f5c\u53c2\u8003\uff1a",
      showReferences: "\u67e5\u770b\u8d44\u6599\u5f15\u7528",
      noReferenceExcerpt: "\u672a\u63d0\u53d6\u5230\u53ef\u9884\u89c8\u7684\u7247\u6bb5",
      materialLibrary: "\u8d44\u6599\u5e93",
      unnamedMaterial: "\u672a\u547d\u540d\u8d44\u6599",
      pagePrefix: "\u7b2c ",
      pageSuffix: " \u9875",
      paragraphPrefix: "\u7b2c ",
      paragraphSuffix: " \u6bb5",
    }[key] || key;
  }

  function jaccardSimple(a, b) {
    const setA = new Set(a.split(""));
    const setB = new Set(b.split(""));
    let inter = 0;
    for (const c of setA) if (setB.has(c)) inter++;
    const union = new Set([...setA, ...setB]).size;
    return union === 0 ? 0 : inter / union;
  }

  root.AutoAnswer.Annotator = { annotateChoice, annotateFill, annotateText, annotateReferenceOnly, markFailed };
})();




