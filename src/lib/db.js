(function () {
  "use strict";
  const root = typeof self !== "undefined" ? self : window;
  root.AutoAnswer = root.AutoAnswer || {};
  const { Matcher, Types } = root.AutoAnswer;

  const DB_NAME = "AutoAnswerDB";
  const DB_VERSION = 1;
  const CACHE_STORE = "questionCache";
  const STATS_STORE = "stats";

  root.AutoAnswer.DB = {
    db: null,

    async open() {
      if (this.db) return this.db;
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(CACHE_STORE)) {
            const store = db.createObjectStore(CACHE_STORE, {
              keyPath: "questionHash",
            });
            store.createIndex("createdAt", "createdAt", { unique: false });
            store.createIndex("hitCount", "hitCount", { unique: false });
          }
          if (!db.objectStoreNames.contains(STATS_STORE)) {
            db.createObjectStore(STATS_STORE, { keyPath: "id" });
          }
        };
        request.onsuccess = (event) => {
          this.db = event.target.result;
          resolve(this.db);
        };
        request.onerror = (event) => reject(event.target.error);
      });
    },

    async addQuestion(questionText, answer, options) {
      const db = await this.open();
      const hash = await Matcher.hashText(questionText);
      const entry = {
        questionHash: hash,
        questionText: questionText,
        options: options || [],
        answer: answer || "",
        answerSource: "ollama",
        confidence: 0.7,
        hitCount: 1,
        pageUrl: root.location ? root.location.href : "",
        createdAt: Date.now(),
      };

      const existing = await this.getByHash(hash);
      if (existing) return this._incrementHit(hash, existing);

      return new Promise((resolve, reject) => {
        const tx = db.transaction(CACHE_STORE, "readwrite");
        tx.objectStore(CACHE_STORE).put(entry);
        tx.oncomplete = () => {
          this._updateStats("totalAnswers", 1);
          this._enforceLimit();
          resolve(entry);
        };
        tx.onerror = (e) => reject(e.target.error);
      });
    },

    async getByHash(hash) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(CACHE_STORE, "readonly");
        const req = tx.objectStore(CACHE_STORE).get(hash);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = (e) => reject(e.target.error);
      });
    },

    async fuzzySearch(questionText) {
      const all = await this._getAll();
      const normalized = Matcher.normalizeText(questionText);
      let best = null;
      let bestScore = 0;

      for (const entry of all) {
        const score = Matcher.jaccardSimilarity(normalized, entry.questionText);
        if (score > bestScore && score >= Types.FUZZY_MATCH_THRESHOLD) {
          bestScore = score;
          best = entry;
        }
      }

      if (best) {
        best.confidence = Math.min(1, best.confidence * (0.5 + bestScore * 0.5));
        this._incrementHit(best.questionHash, best);
      }
      return best;
    },

    async clearCache() {
      const db = await this.open();
      const tx = db.transaction(CACHE_STORE, "readwrite");
      tx.objectStore(CACHE_STORE).clear();
      return new Promise((resolve, reject) => {
        tx.oncomplete = () => {
          const tx2 = db.transaction(STATS_STORE, "readwrite");
          tx2.objectStore(STATS_STORE).put({ id: "totalMatches", value: 0 });
          tx2.objectStore(STATS_STORE).put({ id: "totalAnswers", value: 0 });
          tx2.oncomplete = () => resolve();
          tx2.onerror = (e) => reject(e.target.error);
        };
        tx.onerror = (e) => reject(e.target.error);
      });
    },

    async getStats() {
      const all = await this._getAll();
      const db = await this.open();
      return new Promise((resolve) => {
        const tx = db.transaction(STATS_STORE, "readonly");
        const req = tx.objectStore(STATS_STORE).get("totalMatches");
        req.onsuccess = () =>
          resolve({
            totalCached: all.length,
            totalMatches: req.result ? req.result.value : 0,
          });
        req.onerror = () => resolve({ totalCached: all.length, totalMatches: 0 });
      });
    },

    async _getAll() {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(CACHE_STORE, "readonly");
        const req = tx.objectStore(CACHE_STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = (e) => reject(e.target.error);
      });
    },

    async _incrementHit(hash, entry) {
      const db = await this.open();
      entry.hitCount = (entry.hitCount || 0) + 1;
      entry.confidence = Math.min(1, (entry.confidence || 0.7) + 0.05);
      return new Promise((resolve, reject) => {
        const tx = db.transaction(CACHE_STORE, "readwrite");
        tx.objectStore(CACHE_STORE).put(entry);
        tx.oncomplete = () => {
          this._updateStats("totalMatches", 1);
          resolve(entry);
        };
        tx.onerror = (e) => reject(e.target.error);
      });
    },

    async _updateStats(key, increment) {
      const db = await this.open();
      const tx = db.transaction(STATS_STORE, "readwrite");
      const store = tx.objectStore(STATS_STORE);
      const req = store.get(key);
      req.onsuccess = () => {
        const existing = req.result;
        if (existing) {
          existing.value += increment;
          store.put(existing);
        } else {
          store.put({ id: key, value: increment });
        }
      };
    },

    async _enforceLimit() {
      const all = await this._getAll();
      if (all.length <= Types.CACHE_LIMIT) return;

      all.sort((a, b) => (a.hitCount || 0) - (b.hitCount || 0));
      const toDelete = all.slice(0, all.length - Types.CACHE_LIMIT);
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(CACHE_STORE, "readwrite");
        const store = tx.objectStore(CACHE_STORE);
        for (const entry of toDelete) store.delete(entry.questionHash);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
      });
    },
  };
})();

