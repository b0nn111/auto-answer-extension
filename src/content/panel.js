(function () {
  "use strict";
  const root = typeof self !== "undefined" ? self : window;
  root.AutoAnswer = root.AutoAnswer || {};
  const { Types } = root.AutoAnswer;

  let panelEl = null;
  let statsEl = null;
  let isPanelActive = false;

  function create(getIsActive) {
    if (panelEl) return;

    panelEl = document.createElement("div");
    panelEl.id = "aa-panel";
    panelEl.style.cssText = `
      position:fixed;right:16px;top:80px;z-index:2147483647;
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
      font-size:13px;line-height:1.4;color:#1f2937;
      background:rgba(255,255,255,0.95);backdrop-filter:blur(8px);
      border:1px solid #e5e7eb;border-radius:12px;
      box-shadow:0 4px 24px rgba(0,0,0,0.1);
      padding:12px 16px;min-width:200px;
      user-select:none;cursor:move;
    `;

    panelEl.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <strong style="font-size:14px">🤖 答题助手</strong>
        <button id="aa-close-btn" style="
          background:none;border:none;cursor:pointer;font-size:16px;color:#9ca3af;padding:0;line-height:1
        ">✕</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="font-size:12px;color:#6b7280">答题模式</span>
        <button id="aa-toggle-btn" style="
          position:relative;width:36px;height:20px;border-radius:10px;border:none;
          cursor:pointer;background:#22c55e;transition:background 0.2s
        ">
          <span style="position:absolute;top:2px;left:2px;width:16px;height:16px;
            border-radius:50%;background:white;transition:transform 0.2s"></span>
        </button>
        <button id="aa-retry-btn" title="重新扫描" style="
          margin-left:auto;background:none;border:1px solid #d1d5db;border-radius:6px;
          cursor:pointer;font-size:13px;padding:2px 8px;color:#6b7280
        ">🔄</button>
      </div>
      <div id="aa-stats" style="font-size:12px;color:#6b7280;min-height:36px;white-space:pre-line">
        扫描页面中...
      </div>
      <div id="aa-setup-hint" style="display:none;margin-top:6px;font-size:11px;color:#6366f1;
        background:#eef2ff;border-radius:8px;padding:8px;line-height:1.5;white-space:pre-line"></div>
    `;

    document.body.appendChild(panelEl);
    statsEl = panelEl.querySelector("#aa-stats");

    const toggleBtn = panelEl.querySelector("#aa-toggle-btn");
    toggleBtn.addEventListener("click", () => {
      isPanelActive = !isPanelActive;
      toggleBtn.style.background = isPanelActive ? "#22c55e" : "#d1d5db";
      toggleBtn.querySelector("span").style.transform = isPanelActive
        ? "translateX(0)" : "translateX(16px)";
      if (getIsActive) {
        const cs = root.AutoAnswer.content;
        if (cs && cs.toggle) cs.toggle(isPanelActive);
      }
    });

    panelEl.querySelector("#aa-close-btn").addEventListener("click", () => {
      panelEl.style.display = "none";
    });

    panelEl.querySelector("#aa-retry-btn").addEventListener("click", () => {
      const cs = root.AutoAnswer.content;
      if (cs && cs.retry) cs.retry();
    });

    makeDraggable(panelEl);

    // Check if any AI backend is configured
    checkAIStatus();
  }

  async function checkAIStatus() {
    try {
      const s = await chrome.storage.sync.get(["deepseekKey"]);
      // If no Ollama check and no DeepSeek key, show setup hint
      if (!s.deepseekKey) {
        // Try Ollama check — if it fails too, show "no AI" message
        setTimeout(() => {
          const cs = root.AutoAnswer.content;
          if (cs && cs._noAIResponse) {
            setStatus("no-ai");
          } else {
            // Let content script try, if no response in 6s, assume no AI
            setTimeout(() => {
              if (statsEl && statsEl.textContent.includes("扫描")) {
                setStatus("no-ai");
              }
            }, 6000);
          }
        }, 4000);
      }
    } catch (_) {}
  }

  function setStatus(status, count) {
    if (!statsEl) return;
    const hint = document.getElementById("aa-setup-hint");
    if (hint) hint.style.display = "none";

    const msgs = {
      scanning: "🔍 扫描页面中...",
      waiting: "⏳ 等待页面加载...",
      empty: "😴 未检测到题目\n点击 🔄 重新扫描",
      sending: (n) => `📤 已发送 ${n} 道题，等待答案...`,
      error: "⚠️ 通信异常，点击 🔄 重试",
    };

    if (status === "no-ai") {
      statsEl.textContent = "🛑 未配置 AI 引擎";
      if (hint) {
        hint.style.display = "block";
        hint.innerHTML =
          `可以在网上搜索题目，但建议添加 AI 辅助答题\n\n` +
          `<b>免费 AI 方案（推荐）：AI API</b>（如 DeepSeek、通义千问、SiliconFlow）\n` +
          `1. 打开 你使用的 AI 平台 → 注册 → 创建 API Key\n` +
          `2. 右键扩展图标 → 选项 → 填入 Key\n\n` +
          `<b>本地方案：Ollama</b>\n` +
          `安装 ollama.com → 拉取模型即可`;
      }
      return;
    }

    if (status === "sending") {
      statsEl.textContent = msgs.sending(count || 0);
    } else {
      statsEl.textContent = msgs[status] || status;
    }
  }

  function updateStats(stats) {
    if (!statsEl) return;
    if (!stats) { statsEl.textContent = "等待检测..."; return; }
    const answered = stats.choiceCount + stats.fillCount + stats.shortCount;
    statsEl.textContent = `识别 ${stats.total} 题 · ✅ ${answered} 题 · ❌ ${stats.failCount} 题`;
  }

  function makeDraggable(el) {
    let dragging = false, sx, sy, ox, oy;
    el.addEventListener("mousedown", (e) => {
      if (e.target.closest("button")) return;
      dragging = true; sx = e.clientX; sy = e.clientY;
      ox = el.offsetLeft; oy = el.offsetTop;
      el.style.cursor = "grabbing";
    });
    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      el.style.left = ox + e.clientX - sx + "px";
      el.style.top = oy + e.clientY - sy + "px";
      el.style.right = "auto";
    });
    document.addEventListener("mouseup", () => { dragging = false; el.style.cursor = "move"; });
  }

  root.AutoAnswer.Panel = { create, updateStats, setStatus };
})();

