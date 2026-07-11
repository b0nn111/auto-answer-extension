(function () {
  "use strict";

  const { Types, DB, MaterialDB, Ollama, AiApi } = self.AutoAnswer;
  const $ = (id) => document.getElementById(id);

  let importFileData = null;
  let keyVisible = false;
  let materialState = { folders: [], stats: null };

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

  async function loadMaterials() {
    const response = await chrome.runtime.sendMessage({ type: Types.MSG_TYPE.GET_MATERIAL_LIBRARY });
    if (!response || !response.ok) {
      $("materialStatus").textContent = response?.error || "资料库读取失败";
      $("materialStatus").className = "status err";
      return;
    }
    materialState = response;
    renderMaterials();
  }

  function renderMaterials() {
    const folders = materialState.folders || [];
    const stats = materialState.stats || { folders: 0, files: 0, chunks: 0 };
    $("materialFolderCount").textContent = stats.enabledFolders + "/" + stats.folders + " 个文件夹启用";
    $("materialFileCount").textContent = stats.enabledFiles + "/" + stats.files + " 个文件启用";
    const enabledChunks = stats.enabledChunks ?? stats.chunks;
    $("materialChunkCount").textContent = enabledChunks + "/" + stats.chunks + " 个片段启用";

    const target = $("targetFolder");
    target.innerHTML = folders.length
      ? folders.map((folder) => '<option value="' + escapeAttr(folder.id) + '">' + escapeHtml(folder.name) + "</option>").join("")
      : '<option value="">请先创建文件夹</option>';

    const library = $("materialLibrary");
    if (!folders.length) {
      library.innerHTML = '<div class="empty">还没有资料文件夹。先创建一个课程文件夹。</div>';
      return;
    }

    library.innerHTML = folders.map(renderFolder).join("");
    bindMaterialActions();
  }

  function renderFolder(folder) {
    const files = folder.files || [];
    return [
      '<div class="material-folder" data-folder-id="' + escapeAttr(folder.id) + '">',
      '  <div class="material-folder-head">',
      '    <label class="inline-check"><input type="checkbox" data-action="toggle-folder" ' + (folder.enabled ? "checked" : "") + "> <strong>" + escapeHtml(folder.name) + "</strong></label>",
      '    <button class="link-danger" data-action="delete-folder">删除文件夹</button>',
      "  </div>",
      files.length ? files.map(renderFile).join("") : '<div class="empty small">这个文件夹还没有文件。</div>',
      "</div>",
    ].join("");
  }

  function renderFile(file) {
    const format = ({ pdf: "PDF", docx: "DOCX", pptx: "PPTX", spreadsheet: "表格", text: "文本" })[file.format] || "文本";
    const location = file.pageCount ? " · " + file.pageCount + (file.format === "pptx" ? " 张幻灯片" : " 页") : "";
    return [
      '<div class="material-file" data-file-id="' + escapeAttr(file.id) + '">',
      '  <label class="inline-check"><input type="checkbox" data-action="toggle-file" ' + (file.enabled ? "checked" : "") + "> " + escapeHtml(file.name) + "</label>",
      '  <span class="file-meta">' + format + location + " · " + file.chunkCount + " 片段 · " + formatSize(file.size) + "</span>",
      '  <button class="link-danger" data-action="delete-file">删除</button>',
      "</div>",
    ].join("");
  }

  function bindMaterialActions() {
    document.querySelectorAll("[data-action='toggle-folder']").forEach((input) => {
      input.addEventListener("change", async (event) => {
        const folderId = event.target.closest(".material-folder").dataset.folderId;
        await chrome.runtime.sendMessage({ type: Types.MSG_TYPE.MATERIAL_SET_FOLDER_ENABLED, folderId, enabled: event.target.checked });
        await loadMaterials();
      });
    });
    document.querySelectorAll("[data-action='toggle-file']").forEach((input) => {
      input.addEventListener("change", async (event) => {
        const fileId = event.target.closest(".material-file").dataset.fileId;
        await chrome.runtime.sendMessage({ type: Types.MSG_TYPE.MATERIAL_SET_FILE_ENABLED, fileId, enabled: event.target.checked });
        await loadMaterials();
      });
    });
    document.querySelectorAll("[data-action='delete-folder']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const folder = event.target.closest(".material-folder");
        if (!confirm("确定删除这个资料文件夹及其中所有文件吗？")) return;
        await chrome.runtime.sendMessage({ type: Types.MSG_TYPE.MATERIAL_DELETE_FOLDER, folderId: folder.dataset.folderId });
        await loadMaterials();
      });
    });
    document.querySelectorAll("[data-action='delete-file']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const file = event.target.closest(".material-file");
        if (!confirm("确定删除这个资料文件吗？")) return;
        await chrome.runtime.sendMessage({ type: Types.MSG_TYPE.MATERIAL_DELETE_FILE, fileId: file.dataset.fileId });
        await loadMaterials();
      });
    });
  }

  async function createFolder() {
    const name = $("folderName").value.trim();
    if (!name) {
      showMaterialStatus("请先填写文件夹名称", "err");
      return;
    }
    const response = await chrome.runtime.sendMessage({ type: Types.MSG_TYPE.MATERIAL_CREATE_FOLDER, name });
    if (!response || !response.ok) {
      showMaterialStatus(response?.error || "创建失败", "err");
      return;
    }
    $("folderName").value = "";
    showMaterialStatus("文件夹已创建", "ok");
    materialState = response;
    renderMaterials();
  }

  async function uploadMaterials() {
    const folderId = $("targetFolder").value;
    const files = Array.from($("materialFiles").files || []);
    if (!folderId) {
      showMaterialStatus("请先选择或创建文件夹", "err");
      return;
    }
    if (!files.length) {
      showMaterialStatus("请先选择文件", "err");
      return;
    }

    const uploadButton = $("uploadMaterials");
    const queue = files.map((file) => ({ file, state: "waiting", detail: "等待中" }));
    renderMaterialImportQueue(queue);
    uploadButton.disabled = true;

    let success = 0;
    let skipped = 0;
    let failed = 0;
    try {
      const parser = await waitForMaterialParser();
      for (const item of queue) {
        const file = item.file;
        const existing = await MaterialDB.findFileByName(folderId, file.name);
        if (existing && !confirm("“" + file.name + "”已存在于这个文件夹。是否替换？")) {
          item.state = "skipped";
          item.detail = "已跳过";
          skipped++;
          renderMaterialImportQueue(queue);
          continue;
        }

        try {
          await ensureStorageCapacity(file);
          item.state = "parsing";
          item.detail = "解析中";
          renderMaterialImportQueue(queue);
          const document = await parser.parseFile(file);

          item.state = "indexing";
          item.detail = "建立索引";
          renderMaterialImportQueue(queue);
          await MaterialDB.addDocument(
            folderId,
            { name: file.name, type: file.type, size: file.size },
            document,
            { replaceFileId: existing?.id || "" }
          );
          item.state = "done";
          item.detail = importDoneDetail(document);
          success++;
        } catch (error) {
          item.state = "error";
          item.detail = error?.message || "导入失败";
          failed++;
        }
        renderMaterialImportQueue(queue);
      }
    } catch (error) {
      queue.forEach((item) => {
        if (item.state === "waiting") {
          item.state = "error";
          item.detail = error?.message || "解析器加载失败";
          failed++;
        }
      });
      renderMaterialImportQueue(queue);
    } finally {
      uploadButton.disabled = false;
    }

    $("materialFiles").value = "";
    const detail = ["成功 " + success + " 个"];
    if (skipped) detail.push("跳过 " + skipped + " 个");
    if (failed) detail.push("失败 " + failed + " 个");
    showMaterialStatus("导入完成：" + detail.join("，"), success ? "ok" : "err");
    await loadMaterials();
  }

  function renderMaterialImportQueue(items) {
    $("materialImportQueue").innerHTML = items.map((item) =>
      '<div class="material-import-item" data-state="' + escapeAttr(item.state) + '">' +
      '<span class="material-import-name">' + escapeHtml(item.file.name) + '</span>' +
      '<span class="material-import-state">' + escapeHtml(item.detail) + '</span>' +
      '</div>'
    ).join("");
  }

  function importDoneDetail(document) {
    if (document?.format === "pptx" && document.pageCount) return "完成 · " + document.pageCount + " 张幻灯片";
    if (document?.format === "pdf" && document.pageCount) return "完成 · " + document.pageCount + " 页";
    if (document?.format === "spreadsheet") return "完成 · 表格";
    return "完成";
  }

  function waitForMaterialParser() {
    if (self.AutoAnswer.MaterialParser) return Promise.resolve(self.AutoAnswer.MaterialParser);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("本地文档解析器加载失败，请重新打开设置页")), 10000);
      self.addEventListener("auto-answer-material-parser-ready", () => {
        clearTimeout(timer);
        resolve(self.AutoAnswer.MaterialParser);
      }, { once: true });
    });
  }

  async function ensureStorageCapacity(file) {
    if (!navigator.storage?.estimate) return;
    const estimate = await navigator.storage.estimate();
    const available = Number(estimate.quota || 0) - Number(estimate.usage || 0);
    if (available > 0 && Number(file.size || 0) > available) {
      throw new Error("浏览器本地存储空间不足，请先删除部分资料");
    }
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

  function showMaterialStatus(text, cls) {
    $("materialStatus").textContent = text;
    $("materialStatus").className = "status " + cls;
  }

  function escapeHtml(text) {
    return String(text || "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  function escapeAttr(text) {
    return escapeHtml(text).replace(/`/g, "&#96;");
  }

  function formatSize(size) {
    const bytes = Number(size || 0);
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1024 / 1024).toFixed(1) + " MB";
  }

  document.addEventListener("DOMContentLoaded", () => {
    loadSettings().catch(() => {});
    loadStats().catch(() => {});
    loadMaterials().catch(() => {});

    $("saveBtn").addEventListener("click", saveSettings);
    $("refreshModels").addEventListener("click", refreshModels);
    $("clearCache").addEventListener("click", clearCache);
    $("toggleKey").addEventListener("click", toggleKeyVisibility);
    $("importFile").addEventListener("change", handleImportFileChange);
    $("importBtn").addEventListener("click", importQuestionBank);
    $("createFolder").addEventListener("click", createFolder);
    $("uploadMaterials").addEventListener("click", uploadMaterials);
  });
})();
