(function () {
  "use strict";
  const root = typeof self !== "undefined" ? self : window;
  root.AutoAnswer = root.AutoAnswer || {};

  // ── GitHub Cloud Sync ──
  // Upload/download question banks to/from a GitHub repo
  // Uses a single JSON file in the repo as the cloud storage
  //
  root.AutoAnswer.CloudSync = {
    // Upload local questions to GitHub repo
    async upload(token, repo, path) {
      if (!token || !repo) return { ok: false, error: "请填写 Token 和仓库名" };

      // Read all questions from local DB
      const all = await root.AutoAnswer.DB._getAll().catch(() => null);
      if (!all) return { ok: false, error: "无法读取本地题库" };

      const data = {
        version: 1,
        updatedAt: new Date().toISOString(),
        questions: all.map(q => ({
          questionHash: q.questionHash,
          questionText: q.questionText,
          options: q.options || [],
          answer: q.answer,
          hitCount: q.hitCount || 0,
          createdAt: q.createdAt,
        }))
      };

      const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));

      // Check if file already exists to get SHA
      let sha = null;
      try {
        const getUrl = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`;
        const getResp = await fetch(getUrl, {
          headers: { "Authorization": "Bearer " + token, "Accept": "application/vnd.github.v3+json" },
          signal: AbortSignal.timeout(10000),
        });
        if (getResp.ok) {
          const existing = await getResp.json();
          sha = existing.sha;
        }
      } catch (_) {}

      // Create or update file
      const putUrl = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`;
      const body = { message: "Sync question bank from Auto Answer Helper", content: content };
      if (sha) body.sha = sha;

      try {
        const putResp = await fetch(putUrl, {
          method: "PUT",
          headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json", "Accept": "application/vnd.github.v3+json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15000),
        });

        if (!putResp.ok) {
          const err = await putResp.text().catch(() => "");
          return { ok: false, error: "HTTP " + putResp.status + ": " + err.slice(0, 200) };
        }

        return { ok: true, count: all.length };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    // Download questions from GitHub repo and merge into local DB
    async download(token, repo, path) {
      if (!token || !repo) return { ok: false, error: "请填写 Token 和仓库名" };

      const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`;

      try {
        const resp = await fetch(url, {
          headers: { "Authorization": "Bearer " + token, "Accept": "application/vnd.github.v3+json" },
          signal: AbortSignal.timeout(10000),
        });

        if (!resp.ok) {
          if (resp.status === 404) return { ok: false, error: "云端没有题库文件，请先上传" };
          return { ok: false, error: "HTTP " + resp.status };
        }

        const data = await resp.json();
        const jsonStr = decodeURIComponent(escape(atob(data.content)));
        const parsed = JSON.parse(jsonStr);

        if (!parsed.questions || !Array.isArray(parsed.questions)) {
          return { ok: false, error: "题库文件格式错误" };
        }

        // Merge into local DB
        let added = 0, skipped = 0;
        for (const q of parsed.questions) {
          if (!q.questionText || !q.answer) { skipped++; continue; }
          try {
            await root.AutoAnswer.DB.addQuestion(q.questionText, q.answer, q.options || []);
            added++;
          } catch (_) { skipped++; }
        }

        return { ok: true, added: added, skipped: skipped, total: parsed.questions.length };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  };
})();
