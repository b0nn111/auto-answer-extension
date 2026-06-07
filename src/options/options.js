(function () {
  "use strict";
  const { Types, DB, Ollama } = self.AutoAnswer;

  const $ = (id) => document.getElementById(id);

  async function loadSettings() {
    const stored = await chrome.storage.sync.get(["ollamaUrl", "ollamaModel", "aiApiUrl", "aiApiKey", "aiApiModel", "syncToken", "syncRepo", "syncPath"]);
    if (stored.ollamaUrl) $("ollamaUrl").value = stored.ollamaUrl;
    if (stored.ollamaModel) $("ollamaModel").value = stored.ollamaModel;
    if (stored.aiApiUrl) $("aiApiUrl").value = stored.aiApiUrl;
    if (stored.aiApiModel) $("aiApiModel").value = stored.aiApiModel;
    if (stored.aiApiKey) $("aiApiKey").value = stored.aiApiKey;
    if (stored.syncToken) $("syncToken").value = stored.syncToken;
    if (stored.syncRepo) $("syncRepo").value = stored.syncRepo;
    if (stored.syncPath) $("syncPath").value = stored.syncPath;
    if (stored.autoSync !== undefined) $("autoSync").checked = stored.autoSync;
      if (stored.syncToken) $("syncToken").value = stored.syncToken;
      if (stored.syncRepo) $("syncRepo").value = stored.syncRepo;
      if (stored.syncPath) $("syncPath").value = stored.syncPath;
    if (stored.autoSync !== undefined) $("autoSync").checked = stored.autoSync;
  }

  async function saveSettings() {
    const settings = {
      ollamaUrl: $("ollamaUrl").value.trim() || Types.DEFAULT_OLLAMA_URL,
      ollamaModel: $("ollamaModel").value || Types.DEFAULT_OLLAMA_MODEL,
      aiApiUrl: $("aiApiUrl").value.trim() || Types.DEFAULT_AI_API_URL,
      aiApiModel: $("aiApiModel").value.trim() || Types.DEFAULT_AI_MODEL,
      aiApiKey: $("aiApiKey").value.trim(),
      syncToken: $("syncToken").value.trim(),
      syncRepo: $("syncRepo").value.trim(),
      syncPath: $("syncPath").value.trim(),
      autoSync: $("autoSync").checked,
      syncToken: $("syncToken").value.trim(),
      syncRepo: $("syncRepo").value.trim(),
      syncPath: $("syncPath").value.trim(),
      autoSync: $("autoSync").checked,
    };
    await chrome.storage.sync.set(settings);
    chrome.runtime.sendMessage({ type: Types.MSG_TYPE.SETTINGS_UPDATED, settings });
    const msg = $("saveMsg");
    msg.textContent = "✅ 已保存";
    msg.classList.add("visible");
    setTimeout(() => msg.classList.remove("visible"), 2000);
  }

  async function refreshModels() {
    const status = $("ollamaStatus");
    const url = $("ollamaUrl").value;
    status.textContent = "检测中...";
    status.className = "status";
    
    // Try Ollama protocol first (strip /v1 if present)
    let ollamaUrl = url.replace(/\/v1\/?$/, "").replace(/\/v1\/?$/, "");
    let running = await Ollama.checkRunning(ollamaUrl).catch(() => false);
    if (running) {
      const models = await Ollama.listModels(ollamaUrl).catch(() => []);
      if (models.length > 0) {
        $("ollamaModel").value = models[0];
        status.textContent = "✅ Ollama 已连接，发现 " + models.length + " 个模型";
        status.className = "status ok";
        return;
      }
    }
    
    // Try OpenAI-compatible protocol (LM Studio, etc.)
    const testResult = await self.AutoAnswer.AiApi.testConnection({ 
      baseUrl: url, 
      apiKey: "test", 
      model: $("ollamaModel").value || "default" 
    }).catch(() => ({ ok: false }));
    
    if (testResult.ok) {
      status.textContent = "✅ 本地 AI 已连接（OpenAI 协议）";
      status.className = "status ok";
    } else {
      status.textContent = "❌ 无法连接到 " + url;
      status.className = "status err";
    }
    status.className = "status ok";
  }

  async function loadStats() {
    try {
      const stats = await DB.getStats();
      $("statCached").textContent = stats.totalCached;
      $("statMatched").textContent = stats.totalMatches;
      $("statRate").textContent = stats.totalCached > 0 ? ((stats.totalMatches / stats.totalCached) * 100).toFixed(1) + "%" : "-";
    } catch (_) {}
  }

  async function clearCache() {
    if (!confirm("确定要清空所有缓存的题库数据吗？")) return;
    await DB.clearCache();
    loadStats();
    const msg = $("saveMsg");
    msg.textContent = "🗑️ 题库已清空";
    msg.classList.add("visible");
    setTimeout(() => msg.classList.remove("visible"), 2000);
  }

  let importFileData = null;

  $("importFile").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) { importFileData = null; return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        importFileData = JSON.parse(ev.target.result);
        $("importStatus").textContent = "已读取 " + (importFileData ? importFileData.length : 0) + " 道题，点击导入";
        $("importStatus").className = "status ok";
      } catch (err) {
        $("importStatus").textContent = "❌ JSON 解析失败：" + err.message;
        $("importStatus").className = "status err";
        importFileData = null;
      }
    };
    reader.readAsText(file);
  });

  $("importBtn").addEventListener("click", async () => {
    if (!importFileData || !Array.isArray(importFileData)) {
      $("importStatus").textContent = "请先选择有效的 JSON 文件";
      $("importStatus").className = "status err";
      return;
    }
    const status = $("importStatus");
    let success = 0, fail = 0;
    for (let i = 0; i < importFileData.length; i++) {
      const item = importFileData[i];
      const questionText = item.question || item.questionText || item.q;
      const answer = item.answer || item.a || item.ans;
      const options = item.options || item.choices || [];
      if (!questionText || !answer) { fail++; continue; }
      try {
        await DB.addQuestion(questionText, answer, options);
        success++;
      } catch (_) { fail++; }
      if (i % 50 === 0 || i === importFileData.length - 1) {
        status.textContent = "导入中... " + (i + 1) + "/" + importFileData.length;
      }
    }
    status.textContent = "✅ 导入完成：成功 " + success + " 条" + (fail > 0 ? "，失败 " + fail + " 条" : "");
    status.className = "status ok";
    importFileData = null;
    $("importFile").value = "";
    loadStats();
  });

  let keyVisible = false;
  function toggleKeyVisibility() {
    const input = $("aiApiKey");
    keyVisible = !keyVisible;
    input.type = keyVisible ? "text" : "password";
    $("toggleKey").textContent = keyVisible ? "🙈 隐藏" : "👁️ 显示";
  }

  document.addEventListener("DOMContentLoaded", () => {
    loadSettings();
    loadStats();
    $("saveBtn").addEventListener("click", saveSettings);
    $("refreshModels").addEventListener("click", refreshModels);
    $("clearCache").addEventListener("click", clearCache);
    $("toggleKey").addEventListener("click", toggleKeyVisibility);
    $("syncUploadBtn").addEventListener("click", syncUpload);
    $("syncDownloadBtn").addEventListener("click", syncDownload);
  });

  async function syncUpload() {
    const status = $("syncStatus");
    status.textContent = "上传中...";
    status.className = "status";
    const result = await self.AutoAnswer.CloudSync.upload(
      $("syncToken").value.trim(),
      $("syncRepo").value.trim(),
      $("syncPath").value.trim()
    );
    if (result.ok) {
      status.textContent = "✅ 上传成功，共 " + result.count + " 道题";
      status.className = "status ok";
    } else {
      status.textContent = "❌ " + result.error;
      status.className = "status err";
    }
  }

  async function syncDownload() {
    const status = $("syncStatus");
    status.textContent = "下载中...";
    status.className = "status";
    const result = await self.AutoAnswer.CloudSync.download(
      $("syncToken").value.trim(),
      $("syncRepo").value.trim(),
      $("syncPath").value.trim()
    );
    if (result.ok) {
      status.textContent = "✅ 下载完成：新增 " + result.added + " 题，跳过 " + result.skipped + " 题";
      status.className = "status ok";
      loadStats();
    } else {
      status.textContent = "❌ " + result.error;
      status.className = "status err";
    }
  }
})();









