(function () {
  "use strict";
  const root = typeof self !== "undefined" ? self : window;
  root.AutoAnswer = root.AutoAnswer || {};

  // ── Multi-source web search ──
  // Tries multiple free sources in parallel, returns first successful result.
  // Sources that support CORS:
  //   - Wikipedia API (encyclopedic)
  //   - Stack Exchange API (technical)
  //   - DuckDuckGo Instant Answer (general)
  // Sources that require host_permissions bypass:
  //   - Baidu Zhidao (Chinese exam questions)
  //
  root.AutoAnswer.WebSearch = {
    async search(questionText, timeoutMs) {
      timeoutMs = timeoutMs || 4000;
      const q = questionText.slice(0, 120);

      const sources = [
        this._wiki(q, timeoutMs),
        this._ddg(q, timeoutMs),
        this._baidu(q, timeoutMs),
        this._stackex(q, timeoutMs),
      ];

      const results = await Promise.allSettled(sources);
      for (const r of results) {
        if (r.status === "fulfilled" && r.value && r.value.answer) {
          console.log("[答题助手] 网络搜索命中: " + r.value.source);
          return r.value;
        }
      }
      console.log("[答题助手] 网络搜索全部未命中");
      return null;
    },

    // ── Wikipedia API (CORS ✅) ──
    async _wiki(questionText, timeoutMs) {
      try {
        const resp = await fetch(
          "https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=" +
          encodeURIComponent(questionText) +
          "&format=json&origin=*&srlimit=1",
          { signal: AbortSignal.timeout(timeoutMs) }
        );
        if (!resp.ok) return null;
        const data = await resp.json();
        const snippet = data?.query?.search?.[0]?.snippet || "";
        if (snippet && snippet.length > 10) {
          return { answer: snippet.replace(/<[^>]+>/g, ""), source: "wikipedia", confidence: 0.5 };
        }
        return null;
      } catch { return null; }
    },

    // ── DuckDuckGo Instant Answer (CORS ❓) ──
    async _ddg(questionText, timeoutMs) {
      try {
        const resp = await fetch(
          "https://api.duckduckgo.com/?q=" + encodeURIComponent(questionText) + "&format=json&no_html=1&skip_disambig=1",
          { signal: AbortSignal.timeout(timeoutMs) }
        );
        if (!resp.ok) return null;
        const data = await resp.json();
        const answer = (data.AbstractText || data.Answer || data.Definition || "").trim();
        if (answer && answer.length > 5) {
          return { answer, source: "duckduckgo", confidence: 0.5 };
        }
        return null;
      } catch { return null; }
    },

    // ── Baidu Zhidao (needs host_permissions bypass) ──
    async _baidu(questionText, timeoutMs) {
      try {
        const resp = await fetch(
          "https://zhidao.baidu.com/search?word=" + encodeURIComponent(questionText.slice(0, 100)),
          { signal: AbortSignal.timeout(timeoutMs) }
        );
        if (!resp.ok) return null;
        const html = await resp.text();
        // Try to extract answer
        let match = html.match(/<div[^>]*class=["\x27]answer-content["\x27][^>]*>([\s\S]*?)<\/div>/i);
        if (!match) match = html.match(/答[：:]\s*([^<]{10,300})/i);
        if (match) {
          const answer = match[1].replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
          if (answer && answer.length > 5) {
            return { answer, source: "baidu_zhidao", confidence: 0.5 };
          }
        }
        return null;
      } catch { return null; }
    },

    // ── Stack Exchange API (CORS ✅) ──
    async _stackex(questionText, timeoutMs) {
      try {
        const resp = await fetch(
          "https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=" +
          encodeURIComponent(questionText) +
          "&site=stackoverflow&pagesize=1&filter=withbody",
          { signal: AbortSignal.timeout(timeoutMs) }
        );
        if (!resp.ok) return null;
        const data = await resp.json();
        const body = data?.items?.[0]?.body || "";
        if (body && body.length > 20) {
          const text = body.replace(/<[^>]+>/g, "").trim();
          return { answer: text.slice(0, 500), source: "stackexchange", confidence: 0.5 };
        }
        return null;
      } catch { return null; }
    },
  };
})();

