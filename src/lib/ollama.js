(function () {
  "use strict";
  const root = typeof self !== "undefined" ? self : window;
  root.AutoAnswer = root.AutoAnswer || {};

  root.AutoAnswer.Ollama = {
    async checkRunning(baseUrl) {
      const url = (baseUrl || "http://localhost:11434") + "/api/tags";
      try {
        const resp = await fetch(url, { method: "GET", signal: AbortSignal.timeout(3000) });
        return resp.ok;
      } catch { return false; }
    },

    async listModels(baseUrl) {
      const url = (baseUrl || "http://localhost:11434") + "/api/tags";
      try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!resp.ok) return [];
        const data = await resp.json();
        return (data.models || []).map((m) => m.name);
      } catch { return []; }
    },

    async ask(questionText, opts) {
      const baseUrl = (opts && opts.baseUrl) || "http://localhost:11434";
      const model = (opts && opts.model) || "qwen2.5:7b";
      const options = (opts && opts.options) || [];

      // Include options in prompt for better answer format
      let prompt =
        "你是一个答题助手。请回答下面的题目。\n" +
        "如果是选择题，请输出正确选项的字母和选项内容（如 'B. Paris'），方便验证。\n" +
        "如果是填空题或简答题，直接输出答案，不要解释。\n\n" +
        "题目：" + questionText;
      if (options && options.length > 0) {
        if (!questionContainsOptions(questionText, options)) {
          prompt += "\n\n选项：\n" + options.map(formatOptionForPrompt).join("\n");
        }
      }

      try {
        const resp = await fetch(baseUrl + "/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, prompt, stream: false, options: { temperature: 0.3, top_p: 0.9 } }),
          signal: AbortSignal.timeout(30000),
        });
        if (!resp.ok) return { success: false, error: "HTTP " + resp.status };
        const data = await resp.json();
        return { success: true, answer: (data.response || "").trim(), confidence: 0.7 };
      } catch (err) {
        return { success: false, error: err.message };
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
})();



