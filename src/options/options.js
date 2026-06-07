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
  }

  async function saveSettings() {
    const settings = {
      ollamaUrl: $("ollamaUrl").value.trim() || Types.DEFAULT_OLLAMA_URL,
      ollamaModel: $("ollamaModel").value || Types.DEFAULT_OLLAMA_MODEL,
      aiApiUrl: $("aiApiUrl").value.trim() || Types.DEFAULT_AI_API_URL,
      aiApiModel: $("aiApiModel").value.trim() || Types.DEFAULT_AI_MODEL,
      aiApiKey: $("aiApiKey").value.trim(),
      syncToken: $("syncToken").value.trim().value.trim().value.trim()syncToken: $("syncToken").value.trim().value.trim().value.trim()};
    await chrome.storage.sync.set(settings);
    chrome.runtime.sendMessage({ type: Types.MSG_TYPE.SETTINGS_UPDATED, settings });
    const msg = $("saveMsg");
    msg.textContent = "✅ 已保存";
    msg.classList.add("visible");
    setTimeout(() => msg.classList.remove("visible"), 2000);

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
    
    // Try OpenAI-compatible protocol (LM Studio, etc.)
    const testResult = await self.AutoAnswer.AiApi.testConnection({ 
      baseUrl: url, 
      apiKey: "test", 
      model: $("ollamaModel").value || "default" 
    }).catch(() => ({ ok: false }));
    
    if (testResult.ok) {
      status.textContent = "✅ 本地 AI 已连接（OpenAI 协议）";
    } else {
      status.textContent = "❌ 无法连接到 " + url;
      status.className = "status err";

  async function loadStats() {
    try {
      const stats = await DB.getStats();
      $("statCached").textContent = stats.totalCached;
      $("statMatched").textContent = stats.totalMatches;
      $("statRate").textContent = stats.totalCached > 0 ? ((stats.totalMatches / stats.totalCached) * 100).toFixed(1) + "%" : "-";
    } catch (_) {}

  async function clearCache() {
    if (!confirm("确定要清空所有缓存的题库数据吗？")) return;
    await DB.clearCache();
    loadStats();
    msg.textContent = "🗑️ 题库已清空";

  let importFileData = null;

  $("importFile").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) { importFileData = null; return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
        importFileData = JSON.parse(ev.target.result);
        $("importStatus").textContent = "已读取 " + (importFileData ? importFileData.length : 0) + " 道题，点击导入";
        $("importStatus").className = "status ok";
      } catch (err) {
        $("importStatus").textContent = "❌ JSON 解析失败：" + err.message;
        $("importStatus").className = "status err";
        importFileData = null;
    };
    reader.readAsText(file);
  });

  $("importBtn").addEventListener("click", async () => {
    if (!importFileData || !Array.isArray(importFileData)) {
      $("importStatus").textContent = "请先选择有效的 JSON 文件";
    const status = $("importStatus");
    let success = 0, fail = 0;
    for (let i = 0; i < importFileData.length; i++) {
      const item = importFileData[i];
      const questionText = item.question || item.questionText || item.q;
      const answer = item.answer || item.a || item.ans;
      const options = item.options || item.choices || [];
      if (!questionText || !answer) { fail++; continue; }
        await DB.addQuestion(questionText, answer, options);
        success++;
      } catch (_) { fail++; }
      if (i % 50 === 0 || i === importFileData.length - 1) {
        status.textContent = "导入中... " + (i + 1) + "/" + importFileData.length;
    status.textContent = "✅ 导入完成：成功 " + success + " 条" + (fail > 0 ? "，失败 " + fail + " 条" : "");
    $("importFile").value = "";

  let keyVisible = false;
  function toggleKeyVisibility() {
    const input = $("aiApiKey");
    keyVisible = !keyVisible;
    input.type = keyVisible ? "text" : "password";
    $("toggleKey").textContent = keyVisible ? "🙈 隐藏" : "👁️ 显示";

  document.addEventListener("DOMContentLoaded", () => {
    loadSettings();
    $("saveBtn").addEventListener("click", saveSettings);
    $("refreshModels").addEventListener("click", refreshModels);
    $("clearCache").addEventListener("click", clearCache);
    $("toggleKey").addEventListener("click", toggleKeyVisibility);
    $("syncUploadBtn").addEventListener("click", syncUpload);
      $("syncDownloadBtn").addEventListener("click", syncDownload);
      $("syncUploadSettingsBtn").addEventListener("click", syncUploadSettings);
      $("syncDownloadSettingsBtn").addEventListener("click", syncDownloadSettings);
      // Auto-load settings when token is entered
      $("syncToken").addEventListener("change", async () => {
        if ($("syncToken").value.trim()) {
          const result = await self.AutoAnswer.CloudSync.downloadSettings(
            $("syncToken").value.trim(), $("syncRepo").value.trim()
          ).catch(() => ({}));
          if (result.ok) {
            $("syncStatus").textContent = "✅ 设置已从云端加载，请保存";
            $("syncStatus").className = "status ok";
            // Reload page to apply settings
            setTimeout(() => location.reload(), 2000);

  

  

  

    status.textContent = "✅ 下载完成：新增 " + result.added + " 题，跳过 " + result.skipped + " 题";
      status.textContent = "❌ " + result.error;
})();











