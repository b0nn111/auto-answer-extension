(function () {
  "use strict";
  const root = typeof self !== "undefined" ? self : window;
  root.AutoAnswer = root.AutoAnswer || {};

  const DB_NAME = "AutoAnswerMaterialsDB";
  const DB_VERSION = 2;
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
      const sourceText = normalizeText(text);
      if (!sourceText) throw new Error("No readable text found");
      return this.addDocument(folderId, fileInfo, {
        format: "text",
        parserVersion: 1,
        pageCount: null,
        textLength: sourceText.length,
        blocks: [{
          text: sourceText,
          markdown: sourceText,
          locatorType: "paragraph",
          pageNumber: null,
          headingPath: [],
          paragraphStart: 1,
          paragraphEnd: 1,
        }],
      });
    },

    async addDocument(folderId, fileInfo, document, options) {
      const folder = await getOne(FOLDER_STORE, folderId);
      if (!folder) throw new Error("Folder not found");
      const normalizedDocument = normalizeDocument(document);
      const replaceFileId = String(options?.replaceFileId || "").trim();
      if (replaceFileId) {
        const existing = await getOne(FILE_STORE, replaceFileId);
        if (!existing || existing.folderId !== folderId) throw new Error("Replacement file not found");
      }

      const file = {
        id: makeId("file"),
        folderId,
        folderName: folder.name,
        name: String(fileInfo.name || "").trim() || "未命名资料",
        type: fileInfo.type || "",
        size: fileInfo.size || 0,
        format: normalizedDocument.format,
        parserVersion: normalizedDocument.parserVersion,
        pageCount: normalizedDocument.pageCount,
        status: "ready",
        enabled: true,
        textLength: normalizedDocument.textLength,
        chunkCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const chunks = chunkDocument(file, normalizedDocument);
      if (!chunks.length) throw new Error("No readable text found");
      file.chunkCount = chunks.length;

      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction([FILE_STORE, CHUNK_STORE], "readwrite");
        const fileStore = tx.objectStore(FILE_STORE);
        const chunkStore = tx.objectStore(CHUNK_STORE);
        fileStore.put(file);
        chunks.forEach((chunk) => chunkStore.put(chunk));
        if (replaceFileId) {
          fileStore.delete(replaceFileId);
          chunkStore.index("fileId").openCursor(IDBKeyRange.only(replaceFileId)).onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
              cursor.delete();
              cursor.continue();
            }
          };
        }
        tx.oncomplete = () => resolve({ file, chunks });
        tx.onerror = (event) => reject(event.target.error);
        tx.onabort = (event) => reject(event.target.error || tx.error);
      });
    },

    async findFileByName(folderId, name) {
      const normalizedName = String(name || "").trim().toLocaleLowerCase();
      if (!normalizedName) return null;
      const files = await getAll(FILE_STORE);
      return files.find((file) =>
        file.folderId === folderId && String(file.name || "").trim().toLocaleLowerCase() === normalizedName
      ) || null;
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
          .map(normalizeStoredFile)
          .sort((a, b) => (a.name || "").localeCompare(b.name || "")),
      }));
    },

    async getEnabledChunks() {
      const folders = await getAll(FOLDER_STORE);
      const files = await getAll(FILE_STORE);
      const enabledFolders = new Set(folders.filter((folder) => folder.enabled).map((folder) => folder.id));
      const enabledFiles = new Set(files
        .filter((file) => file.enabled && (file.status === undefined || file.status === "ready") && enabledFolders.has(file.folderId))
        .map((file) => file.id));
      const chunks = await getAll(CHUNK_STORE);
      return chunks.filter((chunk) => enabledFiles.has(chunk.fileId)).map(normalizeStoredChunk);
    },

    async getStats() {
      const folders = await getAll(FOLDER_STORE);
      const files = await getAll(FILE_STORE);
      const chunks = await getAll(CHUNK_STORE);
      const enabledFolderIds = new Set(folders.filter((folder) => folder.enabled).map((folder) => folder.id));
      const enabledFileIds = new Set(files
        .filter((file) => file.enabled && (file.status === undefined || file.status === "ready") && enabledFolderIds.has(file.folderId))
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

  function chunkDocument(file, document) {
    const grouped = groupBlocks(document.blocks, document.format);
    const chunks = [];
    grouped.forEach((block) => {
      splitStructuredBlock(block).forEach((part) => {
        const index = chunks.length;
        chunks.push({
          id: file.id + "_chunk_" + index,
          folderId: file.folderId,
          folderName: file.folderName,
          fileId: file.id,
          fileName: file.name,
          text: part.text,
          markdown: part.markdown,
          locatorType: block.locatorType,
          pageNumber: block.pageNumber,
          headingPath: block.headingPath.slice(),
          paragraphStart: block.paragraphStart,
          paragraphEnd: block.paragraphEnd,
          index,
          createdAt: Date.now(),
        });
      });
    });
    return chunks;
  }

  function groupBlocks(blocks, format) {
    if (format === "pdf") return blocks.map(normalizeInputBlock);
    const groups = [];
    blocks.map(normalizeInputBlock).forEach((block) => {
      const headingKey = block.headingPath.join("\u0000");
      const current = groups[groups.length - 1];
      const canMerge = current && current.headingKey === headingKey && current.markdown.length < DEFAULT_CHUNK_SIZE * 1.5;
      if (!canMerge) {
        groups.push({ ...block, headingKey });
        return;
      }
      current.text += "\n\n" + block.text;
      current.markdown += "\n\n" + block.markdown;
      current.paragraphEnd = block.paragraphEnd ?? current.paragraphEnd;
    });
    return groups;
  }

  function splitStructuredBlock(block) {
    const source = String(block.markdown || block.text || "").trim();
    if (!source) return [];
    const parts = [];
    let start = 0;
    while (start < source.length) {
      let end = Math.min(source.length, start + DEFAULT_CHUNK_SIZE);
      if (end < source.length) {
        const paragraphBoundary = source.lastIndexOf("\n\n", end);
        if (paragraphBoundary > start + DEFAULT_CHUNK_SIZE * 0.6) end = paragraphBoundary;
      }
      const markdown = source.slice(start, end).trim();
      const text = markdownToPlainText(markdown);
      if (text) parts.push({ text, markdown });
      if (end >= source.length) break;
      start = Math.max(start + 1, end - DEFAULT_OVERLAP);
    }
    return parts;
  }

  function normalizeDocument(document) {
    const blocks = Array.isArray(document?.blocks)
      ? document.blocks.map(normalizeInputBlock).filter((block) => block.text)
      : [];
    if (!blocks.length) throw new Error("No readable text found");
    return {
      format: ["pdf", "docx", "text"].includes(document.format) ? document.format : "text",
      parserVersion: Number(document.parserVersion || 1),
      pageCount: Number.isFinite(document.pageCount) ? document.pageCount : null,
      textLength: Number(document.textLength || blocks.reduce((sum, block) => sum + block.text.length, 0)),
      blocks,
    };
  }

  function normalizeInputBlock(block) {
    const text = normalizeText(block?.text);
    return {
      text,
      markdown: String(block?.markdown || text).trim(),
      locatorType: ["page", "heading", "paragraph"].includes(block?.locatorType) ? block.locatorType : "paragraph",
      pageNumber: Number.isFinite(block?.pageNumber) ? block.pageNumber : null,
      headingPath: Array.isArray(block?.headingPath) ? block.headingPath.map((item) => String(item).trim()).filter(Boolean) : [],
      paragraphStart: Number.isFinite(block?.paragraphStart) ? block.paragraphStart : null,
      paragraphEnd: Number.isFinite(block?.paragraphEnd) ? block.paragraphEnd : null,
    };
  }

  function normalizeStoredFile(file) {
    return {
      ...file,
      format: file.format || "text",
      parserVersion: Number(file.parserVersion || 1),
      pageCount: Number.isFinite(file.pageCount) ? file.pageCount : null,
      status: file.status || "ready",
    };
  }

  function normalizeStoredChunk(chunk) {
    return {
      ...chunk,
      markdown: chunk.markdown || chunk.text || "",
      locatorType: chunk.locatorType || "paragraph",
      pageNumber: Number.isFinite(chunk.pageNumber) ? chunk.pageNumber : null,
      headingPath: Array.isArray(chunk.headingPath) ? chunk.headingPath : [],
      paragraphStart: Number.isFinite(chunk.paragraphStart) ? chunk.paragraphStart : null,
      paragraphEnd: Number.isFinite(chunk.paragraphEnd) ? chunk.paragraphEnd : null,
    };
  }

  function markdownToPlainText(markdown) {
    return normalizeText(String(markdown || "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s*([-*+] |\d+\. )/gm, "")
      .replace(/[*_~`>|]/g, " ")
      .replace(/<[^>]+>/g, " "));
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
