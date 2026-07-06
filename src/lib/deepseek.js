(function () {
  "use strict";
  const root = typeof self !== "undefined" ? self : window;
  root.AutoAnswer = root.AutoAnswer || {};

  root.AutoAnswer.AiApi = {
    async ask(questionText, opts) {
      const baseUrl = (opts && opts.baseUrl) || "https://api.deepseek.com/v1";
      const apiKey = (opts && opts.apiKey) || "";
      const model = (opts && opts.model) || "deepseek-chat";
      const options = (opts && opts.options) || [];
      const context = (opts && opts.context) || [];

      if (!apiKey && !baseUrl.match(/^https?:\/\/(localhost|127\.0\.0\.1|::1)/)) return { success: false, error: "No API key configured" };

      let prompt = questionText;
      if (options && options.length > 0 && !questionContainsOptions(questionText, options)) {
        prompt += "\n\n选项：\n" + options.map(formatOptionForPrompt).join("\n");
      }
      if (context && context.length > 0) {
        prompt += "\n\n用户启用资料中检索到的参考片段：\n" + context.map(formatContextForPrompt).join("\n\n");
      }

      const url = baseUrl.replace(/\/+$/, "") + "/chat/completions";

      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + apiKey,
          },
          body: JSON.stringify({
            model: model,
            messages: [
              { role: "system", content: "你是一个答题助手。如果是选择题，请输出正确选项的字母和选项内容（如 'B. Paris'），方便验证。如果提供了用户资料片段，请优先参考资料，但资料和题目冲突时以题目为准。" },
              { role: "user", content: prompt },
            ],
            temperature: 0.3,
            max_tokens: 500,
          }),
          signal: AbortSignal.timeout(60000),
        });

        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          return { success: false, error: "HTTP " + resp.status + ": " + body };
        }

        const data = await resp.json();
        const answer = (data.choices?.[0]?.message?.content || "").trim();
        return { success: true, answer, confidence: 0.9 };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },

    // ── Connection test: sends a minimal request to verify API works ──
    async testConnection(opts) {
      const baseUrl = (opts && opts.baseUrl) || "https://api.deepseek.com/v1";
      const apiKey = (opts && opts.apiKey) || "";
      const model = (opts && opts.model) || "deepseek-chat";

      if (!apiKey) return { ok: false, error: "未配置 API Key" };

      const url = baseUrl.replace(/\/+$/, "") + "/chat/completions";

      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + apiKey,
          },
          body: JSON.stringify({
            model: model,
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1,
          }),
          signal: AbortSignal.timeout(25000),
        });

        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          return { ok: false, error: "HTTP " + resp.status + ": " + (body.slice(0, 200)) };
        }

        return { ok: true, error: null };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  };

  function questionContainsOptions(questionText, options) {
    const text = String(questionText || "");
    return options.every((option) => text.includes(String(option || "").trim()));
  }

  function formatOptionForPrompt(option, index) {
    const text = String(option || "").trim();
    if (/^[A-Z]\s*[\.\)、]/i.test(text)) return text;
    return String.fromCharCode(65 + index) + ". " + text;
  }

  function formatContextForPrompt(item, index) {
    return (index + 1) + ". [" + item.folderName + " / " + item.fileName + "]\n" + item.text;
  }
})();






