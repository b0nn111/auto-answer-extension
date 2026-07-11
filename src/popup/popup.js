document.addEventListener("DOMContentLoaded", () => {
  const hasChromeApi = typeof chrome !== "undefined" && chrome.runtime && chrome.storage;
  const manifest = hasChromeApi && chrome.runtime.getManifest
    ? chrome.runtime.getManifest()
    : { version: "1.4.5" };
  const versionEl = document.getElementById("version");
  if (versionEl) versionEl.textContent = "v" + manifest.version;

  if (!hasChromeApi) {
    updateToggleUI(false);
    setStatus("diag-aiapi", "warn", "预览模式");
    setStatus("diag-localai", "warn", "预览模式");
    setStatus("diag-freesearch", "warn", "预览模式");
    setStatus("diag-materials", "warn", "预览模式");
    setStatus("diag-db", "warn", "预览模式");
    setStatus("diag-ext", "warn", "预览模式");
    const logStatus = document.getElementById("log-status");
    if (logStatus) logStatus.textContent = "静态预览中，扩展 API 不可用";
    return;
  }

  // Load toggle state
  chrome.storage.sync.get(["extensionEnabled"], (s) => {
    const enabled = s.extensionEnabled === true;
    document.getElementById("master-toggle").checked = enabled;
    updateToggleUI(enabled);
  });

  // Toggle handler
  document.getElementById("master-toggle").addEventListener("change", async (e) => {
    const enabled = e.target.checked;
    await chrome.storage.sync.set({ extensionEnabled: enabled });
    updateToggleUI(enabled);
    if (enabled) await ensureActiveTabReady(true);
    // Send to all tabs
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: "EXTENSION_TOGGLE", active: enabled }).catch(() => {});
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
  document.getElementById("copy-logs-btn").addEventListener("click", copyDebugLogs);
  document.getElementById("scan-now-btn").addEventListener("click", async () => {
    await chrome.storage.sync.set({ extensionEnabled: true });
    updateToggleUI(true);
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]?.id) {
      await ensureContentScript(tabs[0]);
      chrome.tabs.sendMessage(tabs[0].id, { type: "EXTENSION_TOGGLE", active: true }).catch(() => {});
      chrome.tabs.sendMessage(tabs[0].id, { type: "RETRY_SCAN" }).catch(() => {});
    }
    window.close();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes.extensionEnabled) return;
    const enabled = changes.extensionEnabled.newValue === true;
    document.getElementById("master-toggle").checked = enabled;
    updateToggleUI(enabled);
  });
});

const CONTENT_SCRIPT_FILES = [
  "src/lib/types.js",
  "src/lib/matcher.js",
  "src/lib/answer-normalizer.js",
  "src/lib/db.js",
  "src/lib/material-db.js",
  "src/lib/material-retriever.js",
  "src/content/annotator.js",
  "src/content/question-normalizer.js",
  "src/content/question-adapters/moodle.js",
  "src/content/question-adapters/generic-form.js",
  "src/content/question-debug.js",
  "src/content/question-extractor.js",
  "src/content/content-script.js",
];

async function ensureActiveTabReady(scanAfterInject) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) return false;
  const ready = await ensureContentScript(tab);
  if (ready && scanAfterInject) {
    await chrome.tabs.sendMessage(tab.id, { type: "EXTENSION_TOGGLE", active: true }).catch(() => {});
    await chrome.tabs.sendMessage(tab.id, { type: "RETRY_SCAN" }).catch(() => {});
  }
  return ready;
}

async function ensureContentScript(tab) {
  if (!tab?.id || !canInjectIntoTab(tab)) return false;
  const ping = await pingContentScript(tab.id);
  if (ping) return true;
  if (!chrome.scripting?.executeScript) return false;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: CONTENT_SCRIPT_FILES,
    });
  } catch (_) {
    return false;
  }
  return pingContentScript(tab.id);
}

async function pingContentScript(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "AA_PING" });
    return response?.ok === true;
  } catch (_) {
    return false;
  }
}

function canInjectIntoTab(tab) {
  const url = String(tab.url || "");
  return /^https?:\/\//i.test(url);
}

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
    const metrics = result.sourceMetrics || {};

    // AI API
    if (result.aiApi?.connected) {
      setStatus("diag-aiapi", "ok", "已连接" + metricSuffix(metrics.ai_api));
    } else if (result.aiApi?.configured) {
      setStatus("diag-aiapi", "err", result.aiApi.error || "连接失败");
    } else {
      setStatus("diag-aiapi", "warn", "未配置");
    }

    // Local AI
    if (result.ollama?.running) {
      setStatus("diag-localai", "ok", "运行中 · " + (result.ollama.models || 0) + " 模型" + metricSuffix(metrics.ollama));
    } else {
      setStatus("diag-localai", "warn", "未运行");
    }

    if (result.freeSearch?.enabled) {
      const url = result.freeSearch.url || "";
      const host = url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      setStatus("diag-freesearch", "ok", "已开启" + (host ? " · " + host : "") + metricSuffix(metrics.free_search));
    } else {
      setStatus("diag-freesearch", "warn", "未开启");
    }

    const materials = result.materials || { enabledFiles: 0, files: 0, chunks: 0 };
    if (materials.files > 0 && materials.enabledFiles > 0) {
      const enabledChunks = materials.enabledChunks ?? materials.chunks;
      setStatus("diag-materials", "ok", materials.enabledFiles + "/" + materials.files + " 文件 · " + enabledChunks + " 片段" + metricSuffix(metrics.materials));
    } else if (materials.files > 0) {
      setStatus("diag-materials", "warn", "未启用文件");
    } else {
      setStatus("diag-materials", "warn", "未添加资料");
    }

    // Database
    const db = result.database;
    if (db?.available) {
      setStatus("diag-db", "ok", db.totalCached + " 题 · 命中 " + (db.totalMatches || 0) + " 次" + metricSuffix(metrics.cache));
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

function metricSuffix(metric) {
  if (!metric || !metric.requests) return "";
  if (metric.lastOutcome === "success") return " · " + metric.lastLatencyMs + "ms";
  if (metric.lastOutcome === "miss") {
    return " · 最近" + (metric.lastError || "未命中");
  }
  const httpStatus = String(metric.lastError || "").match(/HTTP\s+\d+/i);
  return " · 最近" + (httpStatus ? httpStatus[0].toUpperCase() : "失败");
}

function setStatus(id, cls, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = "diag-item " + cls;
  const statusEl = el.querySelector(".diag-status");
  if (statusEl) statusEl.textContent = text;
  const iconMap = { ok: "✓", err: "×", warn: "!", loading: "…" };
  const iconEl = el.querySelector(".diag-icon");
  if (iconEl && iconMap[cls]) iconEl.textContent = iconMap[cls];
}

async function copyDebugLogs() {
  const status = document.getElementById("log-status");
  const button = document.getElementById("copy-logs-btn");
  if (status) status.textContent = "正在导出...";
  if (button) button.disabled = true;

  try {
    const result = await chrome.runtime.sendMessage({ type: "EXPORT_DEBUG_LOGS" });
    if (!result?.ok) throw new Error(result?.error || "导出失败");
    await writeClipboardText(formatDebugLogs(result));
    if (status) {
      const label = result.fromPrevious ? "上一次日志" : "当前日志";
      status.textContent = "已复制 " + label + " · " + result.count + " 条";
    }
  } catch (err) {
    if (status) status.textContent = "日志复制失败：" + (err?.message || "未知错误");
  } finally {
    if (button) button.disabled = false;
  }
}

function formatDebugLogs(result) {
  const entries = Array.isArray(result.entries) ? result.entries : [];
  const header = [
    "自动答题助手诊断日志",
    "导出时间: " + new Date().toISOString(),
    "日志来源: " + (result.fromPrevious ? "上一次已输出日志，本次导出后清除" : "当前日志，导出后保留到下一次导出"),
    "条数: " + entries.length,
    "",
  ];
  if (!entries.length) {
    return header.concat(["暂无可导出的日志"]).join("\n");
  }
  return header.concat(entries.map((entry, index) => {
    return "[" + (index + 1) + "] " + JSON.stringify(entry, null, 2);
  })).join("\n");
}

async function writeClipboardText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}





