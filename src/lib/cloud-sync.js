// Get current extension settings for cloud sync
  function _getSettings() {
    return {
      aiApiUrl: "", aiApiKey: "", aiApiModel: "",
      ollamaUrl: "http://localhost:11434", ollamaModel: "qwen2.5:7b",
      autoSync: false, syncToken: "", syncRepo: "", syncPath: "question-bank.json",
    };
  }

  (function () {
  "use strict";
  const root = typeof self !== "undefined" ? self : window;
  root.AutoAnswer = root.AutoAnswer || {};

  root.AutoAnswer.CloudSync = {
    async upload(token, repo, path) {
      if (!token || !repo) return { ok: false, error: "请填写 Token 和仓库名" };
      const all = await root.AutoAnswer.DB._getAll().catch(() => null);
      if (!all) return { ok: false, error: "无法读取本地题库" };
      const data = {
        version: 1, updatedAt: new Date().toISOString(),
        questions: all.map(q => ({
          questionHash: q.questionHash, questionText: q.questionText,
          options: q.options || [], answer: q.answer,
          hitCount: q.hitCount || 0, createdAt: q.createdAt,
        }))
      };
      const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
      let sha = null;
      try {
        const r = await fetch(`https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`, {
          headers: { "Authorization": "Bearer " + token, "Accept": "application/vnd.github.v3+json" },
          signal: AbortSignal.timeout(10000),
        });
        if (r.ok) { const e = await r.json(); sha = e.sha; }
      } catch (_) {}
      const body = { message: "Sync question bank from Auto Answer Helper", content: content };
      if (sha) body.sha = sha;
      try {
        const r = await fetch(`https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`, {
          method: "PUT", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json", "Accept": "application/vnd.github.v3+json" },
          body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) { const err = await r.text().catch(() => ""); return { ok: false, error: "HTTP " + r.status + ": " + err.slice(0, 200) }; }
        return { ok: true, count: all.length };
      } catch (err) { return { ok: false, error: err.message }; }
    },

    async download(token, repo, path) {
      if (!token || !repo) return { ok: false, error: "请填写 Token 和仓库名" };
      try {
        const r = await fetch(`https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`, {
          headers: { "Authorization": "Bearer " + token, "Accept": "application/vnd.github.v3+json" },
          signal: AbortSignal.timeout(10000),
        });
        if (!r.ok) { return { ok: false, error: r.status === 404 ? "云端没有题库文件，请先上传" : "HTTP " + r.status }; }
        const d = await r.json();
        const json = JSON.parse(decodeURIComponent(escape(atob(d.content))));
        if (!json.questions || !Array.isArray(json.questions)) return { ok: false, error: "题库文件格式错误" };
        let added = 0, skipped = 0;
        for (const q of json.questions) {
          if (!q.questionText || !q.answer) { skipped++; continue; }
          try { await root.AutoAnswer.DB.addQuestion(q.questionText, q.answer, q.options || []); added++; }
          catch (_) { skipped++; }
        }
        return { ok: true, added, skipped, total: json.questions.length };
      } catch (err) { return { ok: false, error: err.message }; }
    },

    async autoUpload() {
      try {
        const s = await chrome.storage.sync.get(["syncToken", "syncRepo", "syncPath", "autoSync"]);
        if (!s.autoSync || !s.syncToken || !s.syncRepo) return;
        const all = await root.AutoAnswer.DB._getAll().catch(() => []);
        if (all.length === 0) return;
        const data = {
          version: 1, updatedAt: new Date().toISOString(),
          questions: all.map(q => ({
            questionHash: q.questionHash, questionText: q.questionText,
            options: q.options || [], answer: q.answer,
            hitCount: q.hitCount || 0, createdAt: q.createdAt,
          }))
        };
        const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
        let sha = null;
        try {
          const r = await fetch(`https://api.github.com/repos/${s.syncRepo}/contents/${encodeURIComponent(s.syncPath)}`, {
            headers: { "Authorization": "Bearer " + s.syncToken, "Accept": "application/vnd.github.v3+json" },
            signal: AbortSignal.timeout(8000),
          });
          if (r.ok) { const e = await r.json(); sha = e.sha; }
        } catch (_) {}
        const body = { message: "Auto sync", content: content };
        if (sha) body.sha = sha;
        await fetch(`https://api.github.com/repos/${s.syncRepo}/contents/${encodeURIComponent(s.syncPath)}`, {
          method: "PUT", headers: { "Authorization": "Bearer " + s.syncToken, "Content-Type": "application/json", "Accept": "application/vnd.github.v3+json" },
          body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
        });
      } catch (_) {}
    },
  };
})();

