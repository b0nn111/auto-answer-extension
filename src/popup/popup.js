document.addEventListener("DOMContentLoaded", () => {
  // Load toggle state
  chrome.storage.sync.get(["extensionEnabled"], (s) => {
    const enabled = s.extensionEnabled === true;
    document.getElementById("master-toggle").checked = enabled;
    updateToggleUI(enabled);
  });

  // Toggle handler
  document.getElementById("master-toggle").addEventListener("change", async (e) => {
    const enabled = e.target.checked;
    chrome.storage.sync.set({ extensionEnabled: enabled });
    updateToggleUI(enabled);
    // Send to all tabs
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: "PANEL_TOGGLE", active: enabled }).catch(() => {});
        if (enabled) {
          chrome.tabs.sendMessage(tab.id, { type: "RETRY_SCAN" }).catch(() => {});
        }
      }
    }
    if (!enabled) window.close();
  });

  // Run diagnostics
  runDiagnostics();

  document.getElementById("settings-btn").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
  document.getElementById("rerun-btn").addEventListener("click", runDiagnostics);
  document.getElementById("scan-now-btn").addEventListener("click", async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, { type: "PANEL_TOGGLE", active: true }).catch(() => {});
      chrome.tabs.sendMessage(tabs[0].id, { type: "RETRY_SCAN" }).catch(() => {});
    }
    window.close();
  });
});

function updateToggleUI(enabled) {
  const status = document.getElementById("toggle-status");
  if (enabled) {
    status.textContent = "开启";
    status.className = "toggle-status on";
  } else {
    status.textContent = "关闭";
    status.className = "toggle-status off";
  }
}

    async function runDiagnostics() {
  setStatus("diag-aiapi", "loading", "检测中...");
  setStatus("diag-localai", "loading", "检测中...");
  setStatus("diag-freesearch", "loading", "检测中...");
  setStatus("diag-materials", "loading", "检测中...");
  setStatus("diag-db", "loading", "检测中...");
  setStatus("diag-ext", "loading", "检测中...");

  try {
    const result = await chrome.runtime.sendMessage({ type: "RUN_DIAGNOSTIC" });
    if (!result) throw new Error("No response");

    // AI API
    if (result.aiApi?.connected) {
      setStatus("diag-aiapi", "ok", "已连接");
    } else if (result.aiApi?.configured) {
      setStatus("diag-aiapi", "err", result.aiApi.error || "连接失败");
    } else {
      setStatus("diag-aiapi", "warn", "未配置");
    }

    // Local AI
    if (result.ollama?.running) {
      setStatus("diag-localai", "ok", "运行中 · " + (result.ollama.models || 0) + " 模型");
    } else {
      setStatus("diag-localai", "warn", "未运行");
    }

    if (result.freeSearch?.enabled) {
      setStatus("diag-freesearch", "ok", "已开启");
    } else {
      setStatus("diag-freesearch", "warn", "未开启");
    }

    const materials = result.materials || { enabledFiles: 0, files: 0, chunks: 0 };
    if (materials.files > 0 && materials.enabledFiles > 0) {
      setStatus("diag-materials", "ok", materials.enabledFiles + "/" + materials.files + " 文件 · " + materials.chunks + " 片段");
    } else if (materials.files > 0) {
      setStatus("diag-materials", "warn", "未启用文件");
    } else {
      setStatus("diag-materials", "warn", "未添加资料");
    }

    // Database
    const db = result.database;
    if (db !== undefined) {
      setStatus("diag-db", "ok", db.totalCached + " 题 · 命中 " + (db.totalMatches || 0) + " 次");
    } else {
      setStatus("diag-db", "err", "不可用");
    }
    setStatus("diag-ext", "ok", "正常运行");
  } catch (e) {
    setStatus("diag-aiapi", "err", "通信失败");
    setStatus("diag-localai", "err", "通信失败");
    setStatus("diag-freesearch", "err", "通信失败");
    setStatus("diag-materials", "err", "通信失败");
    setStatus("diag-db", "err", "通信失败");
    setStatus("diag-ext", "err", "Service Worker 未响应");
  }
}

function setStatus(id, cls, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = "diag-item " + cls;
  const statusEl = el.querySelector(".diag-status");
  if (statusEl) statusEl.textContent = text;
  const iconMap = { ok: "✅", err: "❌", warn: "⚠️", loading: "⏳" };
  const iconEl = el.querySelector(".diag-icon");
  if (iconEl && iconMap[cls]) iconEl.textContent = iconMap[cls];
}





