(function () {
  "use strict";
  const root = typeof self !== "undefined" ? self : window;
  root.AutoAnswer = root.AutoAnswer || {};

  const DB_NAME = "AutoAnswerMaterialsDB";
  const DB_VERSION = 1;
  const FOLDER_STORE = "folders";
  const FILE_STORE = "files";
  const CHUNK_STORE = "chunks";
  const DEFAULT_CHUNK_SIZE = 900;
  const DEFAULT_OVERLAP = 120;

  root.AutoAnswer.MaterialDB = {
    db: null,

    async open() {
      if (this.db) return this.db;
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(FOLDER_STORE)) {
            const store = db.createObjectStore(FOLDER_STORE, { keyPath: "id" });
            store.createIndex("name", "name", { unique: false });
            store.createIndex("enabled", "enabled", { unique: false });
          }
          if (!db.objectStoreNames.contains(FILE_STORE)) {
            const store = db.createObjectStore(FILE_STORE, { keyPath: "id" });
            store.createIndex("folderId", "folderId", { unique: false });
            store.createIndex("enabled", "enabled", { unique: false });
          }
          if (!db.objectStoreNames.contains(CHUNK_STORE)) {
            const store = db.createObjectStore(CHUNK_STORE, { keyPath: "id" });
            store.createIndex("folderId", "folderId", { unique: false });
            store.createIndex("fileId", "fileId", { unique: false });
          }
        };
        request.onsuccess = (event) => {
          this.db = event.target.result;
          resolve(this.db);
        };
        request.onerror = (event) => reject(event.target.error);
      });
    },

    async createFolder(name) {
      const cleanName = String(name || "").trim();
      if (!cleanName) throw new Error("Folder name is required");
      const folder = {
        id: makeId("folder"),
        name: cleanName,
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await putOne(FOLDER_STORE, folder);
      return folder;
    },

    async updateFolderEnabled(folderId, enabled) {
      const folder = await getOne(FOLDER_STORE, folderId);
      if (!folder) throw new Error("Folder not found");
      folder.enabled = enabled === true;
      folder.updatedAt = Date.now();
      await putOne(FOLDER_STORE, folder);
      return folder;
    },

    async updateFileEnabled(fileId, enabled) {
      const file = await getOne(FILE_STORE, fileId);
      if (!file) throw new Error("File not found");
      file.enabled = enabled === true;
      file.updatedAt = Date.now();
      await putOne(FILE_STORE, file);
      return file;
    },

    async addFileText(folderId, fileInfo, text) {
      const folder = await getOne(FOLDER_STORE, folderId);
      if (!folder) throw new Error("Folder not found");
      const sourceText = normalizeText(text);
      if (!sourceText) throw new Error("No readable text found");

      const file = {
        id: makeId("file"),
        folderId,
        folderName: folder.name,
        name: fileInfo.name,
        type: fileInfo.type || "",
        size: fileInfo.size || 0,
        enabled: true,
        textLength: sourceText.length,
        chunkCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const chunks = chunkText(sourceText).map((chunk, index) => ({
        id: file.id + "_chunk_" + index,
        folderId,
        folderName: folder.name,
        fileId: file.id,
        fileName: file.name,
        text: chunk,
        index,
        createdAt: Date.now(),
      }));
      file.chunkCount = chunks.length;

      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction([FILE_STORE, CHUNK_STORE], "readwrite");
        tx.objectStore(FILE_STORE).put(file);
        const chunkStore = tx.objectStore(CHUNK_STORE);
        chunks.forEach((chunk) => chunkStore.put(chunk));
        tx.oncomplete = () => resolve({ file, chunks });
        tx.onerror = (event) => reject(event.target.error);
      });
    },

    async deleteFolder(folderId) {
      const files = (await getAll(FILE_STORE)).filter((file) => file.folderId === folderId);
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction([FOLDER_STORE, FILE_STORE, CHUNK_STORE], "readwrite");
        tx.objectStore(FOLDER_STORE).delete(folderId);
        const fileStore = tx.objectStore(FILE_STORE);
        const chunkStore = tx.objectStore(CHUNK_STORE);
        files.forEach((file) => {
          fileStore.delete(file.id);
          chunkStore.index("fileId").openCursor(IDBKeyRange.only(file.id)).onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
              cursor.delete();
              cursor.continue();
            }
          };
        });
        tx.oncomplete = () => resolve();
        tx.onerror = (event) => reject(event.target.error);
      });
    },

    async deleteFile(fileId) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction([FILE_STORE, CHUNK_STORE], "readwrite");
        tx.objectStore(FILE_STORE).delete(fileId);
        const req = tx.objectStore(CHUNK_STORE).index("fileId").openCursor(IDBKeyRange.only(fileId));
        req.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = (event) => reject(event.target.error);
      });
    },

    async listFoldersWithFiles() {
      const folders = await getAll(FOLDER_STORE);
      const files = await getAll(FILE_STORE);
      folders.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      return folders.map((folder) => ({
        ...folder,
        files: files
          .filter((file) => file.folderId === folder.id)
          .sort((a, b) => (a.name || "").localeCompare(b.name || "")),
      }));
    },

    async getEnabledChunks() {
      const folders = await getAll(FOLDER_STORE);
      const files = await getAll(FILE_STORE);
      const enabledFolders = new Set(folders.filter((folder) => folder.enabled).map((folder) => folder.id));
      const enabledFiles = new Set(files.filter((file) => file.enabled && enabledFolders.has(file.folderId)).map((file) => file.id));
      const chunks = await getAll(CHUNK_STORE);
      return chunks.filter((chunk) => enabledFiles.has(chunk.fileId));
    },

    async getStats() {
      const folders = await getAll(FOLDER_STORE);
      const files = await getAll(FILE_STORE);
      const chunks = await getAll(CHUNK_STORE);
      const enabledFolderIds = new Set(folders.filter((folder) => folder.enabled).map((folder) => folder.id));
      const enabledFileIds = new Set(files
        .filter((file) => file.enabled && enabledFolderIds.has(file.folderId))
        .map((file) => file.id));
      return {
        folders: folders.length,
        enabledFolders: enabledFolderIds.size,
        files: files.length,
        enabledFiles: enabledFileIds.size,
        chunks: chunks.length,
        enabledChunks: chunks.filter((chunk) => enabledFileIds.has(chunk.fileId)).length,
      };
    },
  };

  async function getOne(storeName, key) {
    const db = await root.AutoAnswer.MaterialDB.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = (event) => reject(event.target.error);
    });
  }

  async function putOne(storeName, value) {
    const db = await root.AutoAnswer.MaterialDB.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => resolve(value);
      tx.onerror = (event) => reject(event.target.error);
    });
  }

  async function getAll(storeName) {
    const db = await root.AutoAnswer.MaterialDB.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (event) => reject(event.target.error);
    });
  }

  function chunkText(text) {
    const chunks = [];
    let index = 0;
    while (index < text.length) {
      const end = Math.min(text.length, index + DEFAULT_CHUNK_SIZE);
      chunks.push(text.slice(index, end));
      if (end >= text.length) break;
      index = Math.max(0, end - DEFAULT_OVERLAP);
    }
    return chunks;
  }

  function normalizeText(text) {
    return String(text || "")
      .replace(/\r\n/g, "\n")
      .replace(/\t/g, " ")
      .replace(/[ \u00a0]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function makeId(prefix) {
    return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }
})();
