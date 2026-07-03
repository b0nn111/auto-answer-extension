(function () {
  "use strict";

  const { Types, DB, Ollama, AiApi } = self.AutoAnswer;
  const $ = (id) => document.getElementById(id);

  let importFileData = null;
  let keyVisible = false;

  async function loadSettings() {
    const stored = await chrome.storage.sync.get([
      "ollamaUrl",
      "ollamaModel",
      "aiApiUrl",
      "aiApiKey",
      "aiApiModel",
      "deepseekKey",
      "freeSearchEnabled",
      "freeSearchUrl",
    ]);

    if (stored.ollamaUrl) $("ollamaUrl").value = stored.ollamaUrl;
    if (stored.ollamaModel) $("ollamaModel").value = stored.ollamaModel;
    if (stored.aiApiUrl) $("aiApiUrl").value = stored.aiApiUrl;
    if (stored.aiApiModel) $("aiApiModel").value = stored.aiApiModel;
    if (stored.aiApiKey || stored.deepseekKey) $("aiApiKey").value = stored.aiApiKey || stored.deepseekKey;
    $("freeSearchEnabled").checked = stored.freeSearchEnabled === true;
    if (stored.freeSearchUrl) $("freeSearchUrl").value = stored.freeSearchUrl;
  }

  async function saveSettings() {
    const settings = {
      ollamaUrl: $("ollamaUrl").value.trim() || Types.DEFAULT_OLLAMA_URL,
      ollamaModel: $("ollamaModel").value.trim() || Types.DEFAULT_OLLAMA_MODEL,
      aiApiUrl: $("aiApiUrl").value.trim() || Types.DEFAULT_AI_API_URL,
      aiApiModel: $("aiApiModel").value.trim() || Types.DEFAULT_AI_MODEL,
      aiApiKey: $("aiApiKey").value.trim(),
      freeSearchEnabled: $("freeSearchEnabled").checked,
      freeSearchUrl: $("freeSearchUrl").value.trim() || Types.DEFAULT_FREE_SEARCH_URL,
    };

    await chrome.storage.sync.set(settings);
    try {
      chrome.runtime.sendMessage({ type: Types.MSG_TYPE.SETTINGS_UPDATED, settings }, () => {
        void chrome.runtime.lastError;
      });
    } catch (_) {}
    showSaveMessage("已保存");
  }

  async function refreshModels() {
    const status = $("ollamaStatus");
    const url = $("ollamaUrl").value.trim() || Types.DEFAULT_OLLAMA_URL;
    const model = $("ollamaModel").value.trim() || Types.DEFAULT_OLLAMA_MODEL;

    status.textContent = "检测中...";
    status.className = "status";

    const ollamaBaseUrl = url.replace(/\/v1\/?$/, "");
    const ollamaRunning = await Ollama.checkRunning(ollamaBaseUrl).catch(() => false);
    if (ollamaRunning) {
      const models = await Ollama.listModels(ollamaBaseUrl).catch(() => []);
      if (models.length > 0) $("ollamaModel").value = models[0];
      status.textContent = models.length > 0
        ? "已连接本地 AI，发现 " + models.length + " 个模型"
        : "已连接本地 AI，请手动填写模型名称";
      status.className = "status ok";
      return;
    }

    const openAiResult = await AiApi.testConnection({
      baseUrl: url,
      apiKey: "local",
      model,
    }).catch((err) => ({ ok: false, error: err.message }));

    if (openAiResult.ok) {
      status.textContent = "已连接本地 AI（OpenAI 兼容接口）";
      status.className = "status ok";
    } else {
      status.textContent = "无法连接到 " + url + (openAiResult.error ? "：" + openAiResult.error : "");
      status.className = "status err";
    }
  }

  async function loadStats() {
    try {
      const stats = await DB.getStats();
      const totalCached = stats.totalCached || 0;
      const totalMatches = stats.totalMatches || 0;
      const referenceRate = totalCached > 0
        ? Math.min(100, (totalMatches / totalCached) * 100).toFixed(0) + "%"
        : "-";

      $("statCached").textContent = totalCached;
      $("statMatched").textContent = totalMatches;
      $("statRate").textContent = referenceRate;
    } catch (_) {
      $("statCached").textContent = "-";
      $("statMatched").textContent = "-";
      $("statRate").textContent = "-";
    }
  }

  async function clearCache() {
    if (!confirm("确定要清空所有缓存的题库数据吗？")) return;
    await DB.clearCache();
    await loadStats();
    showSaveMessage("题库已清空");
  }

  function handleImportFileChange(e) {
    const file = e.target.files[0];
    if (!file) {
      importFileData = null;
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (!Array.isArray(parsed)) throw new Error("JSON 根节点必须是数组");
        importFileData = parsed;
        $("importStatus").textContent = "已读取 " + parsed.length + " 道题，点击导入";
        $("importStatus").className = "status ok";
      } catch (err) {
        importFileData = null;
        $("importStatus").textContent = "JSON 解析失败：" + err.message;
        $("importStatus").className = "status err";
      }
    };
    reader.readAsText(file);
  }

  async function importQuestionBank() {
    const status = $("importStatus");
    if (!importFileData || !Array.isArray(importFileData)) {
      status.textContent = "请先选择有效的 JSON 文件";
      status.className = "status err";
      return;
    }

    let success = 0;
    let fail = 0;

    for (let i = 0; i < importFileData.length; i++) {
      const item = importFileData[i];
      const questionText = item.question || item.questionText || item.q;
      const answer = item.answer || item.a || item.ans;
      const options = item.options || item.choices || [];

      if (!questionText || !answer) {
        fail++;
        continue;
      }

      try {
        await DB.addQuestion(questionText, answer, options);
        success++;
      } catch (_) {
        fail++;
      }

      if (i % 50 === 0 || i === importFileData.length - 1) {
        status.textContent = "导入中... " + (i + 1) + "/" + importFileData.length;
      }
    }

    status.textContent = "导入完成：成功 " + success + " 条" + (fail > 0 ? "，失败 " + fail + " 条" : "");
    status.className = success > 0 ? "status ok" : "status err";
    $("importFile").value = "";
    importFileData = null;
    await loadStats();
  }

  function toggleKeyVisibility() {
    const input = $("aiApiKey");
    keyVisible = !keyVisible;
    input.type = keyVisible ? "text" : "password";
    $("toggleKey").textContent = keyVisible ? "隐藏" : "显示";
  }

  function showSaveMessage(text) {
    const msg = $("saveMsg");
    msg.textContent = text;
    msg.classList.add("visible");
    setTimeout(() => msg.classList.remove("visible"), 2000);
  }

  document.addEventListener("DOMContentLoaded", () => {
    loadSettings().catch(() => {});
    loadStats().catch(() => {});

    $("saveBtn").addEventListener("click", saveSettings);
    $("refreshModels").addEventListener("click", refreshModels);
    $("clearCache").addEventListener("click", clearCache);
    $("toggleKey").addEventListener("click", toggleKeyVisibility);
    $("importFile").addEventListener("change", handleImportFileChange);
    $("importBtn").addEventListener("click", importQuestionBank);
  });
})();
