"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const vm = require("node:vm");

const root = process.cwd();
const read = (path) => fs.readFileSync(root + "/" + path, "utf8");

function loadNormalizer() {
  const context = { self: { AutoAnswer: {} }, console };
  vm.runInNewContext(read("src/lib/answer-normalizer.js"), context);
  return { context, normalizer: context.self.AutoAnswer.AnswerNormalizer };
}

function testAnswerNormalization() {
  const { normalizer } = loadNormalizer();
  const options = ["A. One", "B. Two", "C. Three", "D. Four"];
  const expected = ["A", "C"];

  assert.deepEqual(Array.from(normalizer.match("A,C", options, true).letters), expected);
  assert.deepEqual(Array.from(normalizer.match("A、C", options, true).letters), expected);
  assert.deepEqual(Array.from(normalizer.match("A；C", options, true).letters), expected);
  assert.deepEqual(Array.from(normalizer.match("AC", options, true).letters), expected);
  assert.deepEqual(Array.from(normalizer.match("答案是 A 和 C", options, true).letters), expected);
  assert.deepEqual(Array.from(normalizer.match("A. One；C. Three", options, true).letters), expected);
  assert.deepEqual(Array.from(normalizer.match("B. Two", options, false).letters), ["B"]);
  assert.deepEqual(Array.from(normalizer.match("A. Apple and C language", ["A. Apple and C language", "B. Other", "C. Third"], true).letters), ["A"]);
  assert.equal(normalizer.match("A,E", options, true).matched, false);
}

async function testPublicSearchUsesSharedNormalizer() {
  const { context } = loadNormalizer();
  context.AbortSignal = AbortSignal;
  context.fetch = async () => ({
    ok: true,
    json: async () => ({ code: 200, data: { answer: "A#C" } }),
  });
  vm.runInNewContext(read("src/lib/websearch.js"), context);
  const result = await context.self.AutoAnswer.WebSearch.search("Pick all correct values", {
    options: ["A. One", "B. Two", "C. Three"],
    multiple: true,
  });
  assert.equal(result.success, true);
  assert.deepEqual(Array.from(result.optionLetters), ["A", "C"]);
}

function createBackground(config) {
  let listener;
  const state = { fuzzyCalls: 0, hitCalls: 0 };
  const Types = {
    MSG_TYPE: {
      DETECT_QUESTIONS: "DETECT_QUESTIONS",
      SETTINGS_UPDATED: "SETTINGS_UPDATED",
      GET_STATS: "GET_STATS",
      CLEAR_CACHE: "CLEAR_CACHE",
      OLLAMA_CHECK: "OLLAMA_CHECK",
      OLLAMA_LIST_MODELS: "OLLAMA_LIST_MODELS",
      RUN_DIAGNOSTIC: "RUN_DIAGNOSTIC",
      GET_MATERIAL_LIBRARY: "GET_MATERIAL_LIBRARY",
      MATERIAL_CREATE_FOLDER: "MATERIAL_CREATE_FOLDER",
      MATERIAL_ADD_FILE: "MATERIAL_ADD_FILE",
      MATERIAL_SET_FOLDER_ENABLED: "MATERIAL_SET_FOLDER_ENABLED",
      MATERIAL_SET_FILE_ENABLED: "MATERIAL_SET_FILE_ENABLED",
      MATERIAL_DELETE_FOLDER: "MATERIAL_DELETE_FOLDER",
      MATERIAL_DELETE_FILE: "MATERIAL_DELETE_FILE",
    },
    ANSWER_SOURCE: {
      CACHE: "cache",
      MATERIAL: "material",
      MATERIAL_AI: "material_ai",
      FREE_SEARCH: "free_search",
      OLLAMA: "ollama",
      AI_API: "ai_api",
      FAILED: "failed",
    },
    QUESTION_TYPE: { CHOICE: "choice", FILL: "fill", SHORT_ANSWER: "short_answer", CODING: "coding" },
    DEFAULT_OLLAMA_URL: "http://localhost:11434",
    DEFAULT_OLLAMA_MODEL: "model",
    DEFAULT_AI_API_URL: "https://example.test/v1",
    DEFAULT_AI_MODEL: "model",
    DEFAULT_FREE_SEARCH_URL: "https://example.test/search",
  };
  const { normalizer } = loadNormalizer();
  const DB = {
    getByHash: async () => config.exact || null,
    fuzzySearch: async () => { state.fuzzyCalls++; return config.fuzzy || null; },
    _incrementHit: async () => { state.hitCalls++; },
    getStats: async () => ({ totalCached: config.exact ? 1 : 0, totalMatches: state.hitCalls }),
    clearCache: async () => {},
  };
  const context = {
    self: { AutoAnswer: {
      Types,
      DB,
      Matcher: { hashText: async () => "hash", normalizeText: normalizer.normalize, jaccardSimilarity: () => 0 },
      AnswerNormalizer: normalizer,
      MaterialDB: {
        getStats: async () => ({ folders: 0, enabledFolders: 0, files: 0, enabledFiles: 0, chunks: 0 }),
        listFoldersWithFiles: async () => [],
      },
      MaterialRetriever: { retrieve: async () => config.materials || [] },
      WebSearch: { search: async () => config.freeResult || { success: false, error: "未命中" } },
      Ollama: {
        checkRunning: async () => config.ollamaRunning === true,
        ask: async () => config.ollamaResult || { success: false, error: "未运行" },
        listModels: async () => [],
      },
      AiApi: {
        ask: async (...args) => config.aiAsk ? config.aiAsk(...args) : (config.aiResult || { success: false, error: "未配置" }),
        testConnection: async () => ({ ok: true }),
      },
    } },
    chrome: {
      storage: { sync: { get: async () => ({
        freeSearchEnabled: config.freeEnabled === true,
        aiApiKey: config.aiEnabled === true ? "test-key" : "",
      }) } },
      runtime: { onMessage: { addListener: (fn) => { listener = fn; } } },
    },
    importScripts() {},
    console,
  };
  vm.runInNewContext(read("src/background/service-worker.js"), context);
  return {
    state,
    send(message) {
      return new Promise((resolve) => listener(message, {}, resolve));
    },
  };
}

async function testExactMatchSkipsFuzzySearch() {
  const background = createBackground({ exact: { answer: "B. Two", confidence: 0.8 } });
  const results = await background.send({
    type: "DETECT_QUESTIONS",
    questions: [{ id: "q1", type: "choice", questionText: "Pick one", options: ["A. One", "B. Two"] }],
  });
  assert.equal(results[0].answer, "B. Two");
  assert.equal(background.state.hitCalls, 1);
  assert.equal(background.state.fuzzyCalls, 0);
}

async function testConsensusAndMetrics() {
  const background = createBackground({
    freeEnabled: true,
    aiEnabled: true,
    freeResult: { success: true, answer: "A,C", confidence: 0.82 },
    aiResult: { success: true, answer: "C、A", confidence: 0.9 },
  });
  const results = await background.send({
    type: "DETECT_QUESTIONS",
    questions: [{ id: "q1", type: "choice", multiple: true, questionText: "Pick all", options: ["A. One", "B. Two", "C. Three"] }],
  });
  assert.deepEqual(Array.from(results[0].optionLetters), ["A", "C"]);
  assert.equal(results[0].candidates.length, 2);
  assert.ok(results[0].candidates.every((candidate) => candidate.consensusCount === 2));
  assert.ok(results[0].candidates.every((candidate) => candidate.confidence > candidate.baseConfidence));
  assert.equal(results[0].warning, "");

  const diagnostic = await background.send({ type: "RUN_DIAGNOSTIC" });
  assert.equal(diagnostic.sourceMetrics.free_search.successes, 1);
  assert.equal(diagnostic.sourceMetrics.ai_api.successes, 1);
  assert.equal(diagnostic.sourceMetrics.cache.misses, 1);
}

function testMaterialCitationFormatting() {
  const context = { self: { AutoAnswer: { MaterialDB: { getEnabledChunks: async () => [] } } } };
  vm.runInNewContext(read("src/lib/material-retriever.js"), context);
  const citation = context.self.AutoAnswer.MaterialRetriever.formatCitation({
    folderName: "Calculus",
    fileName: "Lecture 1.pdf",
    pageNumber: 3,
  });
  assert.equal(citation, "Calculus / Lecture 1.pdf / \u7b2c3\u9875");
}

async function testMaterialParserHelpers() {
  globalThis.DOMMatrix ||= class {};
  globalThis.ImageData ||= class {};
  globalThis.Path2D ||= class {};
  globalThis.navigator ||= { userAgent: "Node", platform: "Win32" };

  const parserModule = await import(pathToFileURL(root + "/src/lib/material-parser.mjs"));
  const { MaterialParser, parseDelimitedRows, spreadsheetRowsToBlocks } = parserModule;

  assert.equal(MaterialParser.detectFormat({ name: "lecture.pptx", type: "" }), "pptx");
  assert.equal(MaterialParser.detectFormat({ name: "scores.xlsx", type: "" }), "spreadsheet");
  assert.equal(MaterialParser.detectFormat({ name: "scores.csv", type: "text/csv" }), "spreadsheet");
  assert.equal(MaterialParser.detectFormat({ name: "old.xls", type: "" }), "unsupported");

  assert.deepEqual(parseDelimitedRows('name,answer\n"rate, change","A ""quoted"" value"', ","), [
    ["name", "answer"],
    ["rate, change", 'A "quoted" value'],
  ]);
  assert.deepEqual(parseDelimitedRows("topic\tvalue\ncalculus\tderivative", "\t"), [
    ["topic", "value"],
    ["calculus", "derivative"],
  ]);

  const rows = Array.from({ length: 41 }, (_, index) => ["Row " + (index + 1), "value"]);
  const blocks = spreadsheetRowsToBlocks("Sheet1", rows);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].paragraphStart, 1);
  assert.equal(blocks[1].paragraphStart, 41);
  assert.ok(blocks[0].markdown.includes("Row 40: Row 40 | value"));
}

async function testReferenceOnlyFromServiceWorker() {
  const background = createBackground({
    materials: [{
      folderName: "Calculus",
      fileName: "Lecture 1.pdf",
      text: "Derivative measures instantaneous rate of change.",
      citation: "Calculus / Lecture 1.pdf / \u7b2c3\u9875",
      pageNumber: 3,
    }],
  });
  const results = await background.send({
    type: "DETECT_QUESTIONS",
    questions: [{ id: "q1", type: "short_answer", questionText: "What does a derivative measure?" }],
  });
  assert.equal(results[0].referenceOnly, true);
  assert.equal(results[0].answer, "");
  assert.equal(results[0].source, "material");
  assert.equal(results[0].materials.length, 1);
}

async function testConflictWarning() {
  const background = createBackground({
    freeEnabled: true,
    aiEnabled: true,
    freeResult: { success: true, answer: "A. One", confidence: 0.82 },
    aiResult: { success: true, answer: "C. Three", confidence: 0.9 },
  });
  const results = await background.send({
    type: "DETECT_QUESTIONS",
    questions: [{ id: "q1", type: "choice", questionText: "Pick one", options: ["A. One", "B. Two", "C. Three"] }],
  });
  assert.match(results[0].warning, /冲突/);
}

async function testQuestionConcurrencyLimit() {
  let active = 0;
  let maxActive = 0;
  const background = createBackground({
    aiEnabled: true,
    aiAsk: async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return { success: true, answer: "A. One", confidence: 0.9 };
    },
  });
  const questions = Array.from({ length: 9 }, (_, index) => ({
    id: "q" + index,
    type: "choice",
    questionText: "Pick one " + index,
    options: ["A. One", "B. Two"],
  }));
  const results = await background.send({ type: "DETECT_QUESTIONS", questions });
  assert.equal(results.length, 9);
  assert.ok(maxActive <= 4);
}

function makeChoiceRow(letter, text) {
  const numberElement = {
    textContent: letter + ".",
    cloneNode() { return { textContent: this.textContent, querySelectorAll: () => [] }; },
  };
  const row = {
    textContent: letter + ". " + text,
    highlighted: false,
    badge: "",
    classList: { add: (name) => { if (name === "aa-highlight-option") row.highlighted = true; } },
    querySelector(selector) { return selector === ".answernumber" ? numberElement : null; },
    cloneNode() { return { textContent: this.textContent, querySelectorAll: () => [] }; },
    insertAdjacentHTML(_where, html) { row.badge += html; },
  };
  return row;
}

function testMultipleChoiceAnnotationAndEscaping() {
  const { context } = loadNormalizer();
  context.self.AutoAnswer.Types = {};
  context.document = { getElementById: () => ({}) };
  vm.runInNewContext(read("src/content/annotator.js"), context);

  const rows = [makeChoiceRow("A", "One"), makeChoiceRow("B", "Two"), makeChoiceRow("C", "Three")];
  const container = {
    querySelectorAll: (selector) => selector === ".answer .r0, .answer .r1" ? rows : [],
    insertAdjacentHTML() {},
    appendChild() {},
  };
  context.self.AutoAnswer.Annotator.annotateChoice(container, {
    answer: "A. One；C. Three",
    optionLetters: ["A", "C"],
    multiple: true,
    source: "ai_api",
    confidence: 0.9,
  });
  assert.equal(rows[0].highlighted, true);
  assert.equal(rows[1].highlighted, false);
  assert.equal(rows[2].highlighted, true);
  assert.ok(rows[0].badge.includes("A. One；C. Three"));
  assert.equal(rows[2].badge, "");

  const partialRows = [makeChoiceRow("A", "One"), makeChoiceRow("B", "Two"), makeChoiceRow("C", "Three")];
  let questionLevelBadge = "";
  const partialContainer = {
    querySelectorAll: (selector) => selector === ".answer .r0, .answer .r1" ? partialRows : [],
    insertAdjacentHTML: (_where, html) => { questionLevelBadge += html; },
    appendChild() {},
  };
  context.self.AutoAnswer.Annotator.annotateChoice(partialContainer, {
    answer: "A. One；D. Missing",
    optionLetters: ["A", "D"],
    multiple: true,
    source: "ai_api",
    confidence: 0.9,
  });
  assert.equal(partialRows.some((row) => row.highlighted), false);
  assert.ok(questionLevelBadge.includes("A. One；D. Missing"));

  let inserted = "";
  const unmatched = {
    querySelectorAll: () => [],
    insertAdjacentHTML: (_where, html) => { inserted += html; },
    appendChild() {},
  };
  context.self.AutoAnswer.Annotator.annotateChoice(unmatched, {
    answer: '<img src=x onerror="alert(1)">',
    source: "ai_api",
    confidence: 0.9,
  });
  assert.equal(inserted.includes("<img"), false);
  assert.equal(inserted.includes("&lt;img"), true);

  const longAnswer = "Long answer " + "content ".repeat(30) + "VISIBLE_END";
  let longInserted = "";
  const longContainer = {
    querySelectorAll: () => [],
    insertAdjacentHTML: (_where, html) => { longInserted += html; },
    appendChild() {},
  };
  context.self.AutoAnswer.Annotator.annotateChoice(longContainer, {
    answer: longAnswer,
    source: "ai_api",
    confidence: 0.9,
  });
  assert.ok(longInserted.includes("VISIBLE_END"));
  assert.equal(longInserted.includes("..."), false);
}

function testReferenceOnlyAnnotationEscapesHtml() {
  const { context } = loadNormalizer();
  context.self.AutoAnswer.Types = {};
  const created = [];
  context.document = {
    getElementById: () => ({}),
    createElement: (tag) => {
      const element = {
        tag,
        className: "",
        innerHTML: "",
        textContent: "",
        appendChild(child) { this.children = (this.children || []).concat(child); },
        addEventListener() {},
      };
      created.push(element);
      return element;
    },
  };
  vm.runInNewContext(read("src/content/annotator.js"), context);
  const appended = [];
  const container = { appendChild: (node) => appended.push(node) };
  context.self.AutoAnswer.Annotator.annotateReferenceOnly(container, {
    questionStem: '<img src=x onerror="alert(1)">',
    materials: [{
      citation: 'Folder / <script>alert(1)</script>',
      text: '<img src=x onerror="alert(2)"> useful excerpt',
    }],
  });
  assert.equal(appended.length, 1);
  assert.equal(appended[0].innerHTML.includes("<script>"), false);
  assert.equal(appended[0].innerHTML.includes("<img"), false);
  assert.ok(appended[0].innerHTML.includes("&lt;script&gt;"));
  assert.ok(appended[0].innerHTML.includes("&lt;img"));
}

function testDisableClearsAnnotations() {
  let runtimeListener;
  let removed = 0;
  const marker = { remove: () => { removed++; }, classList: { remove: () => { removed++; } } };
  const document = {
    readyState: "complete",
    body: {},
    getElementById: () => null,
    querySelectorAll: (selector) => selector.includes(".aa-") ? [marker] : [],
    addEventListener() {},
  };
  const context = {
    self: { AutoAnswer: {
      Types: {
        MSG_TYPE: { EXTENSION_TOGGLE: "EXTENSION_TOGGLE" },
        QUESTION_TYPE: {},
        ANSWER_SOURCE: { FAILED: "failed" },
      },
      Matcher: {},
      Annotator: {},
    } },
    document,
    chrome: {
      storage: {
        sync: { get: (_keys, cb) => cb({ extensionEnabled: true }), set() {} },
        onChanged: { addListener() {} },
      },
      runtime: { onMessage: { addListener: (fn) => { runtimeListener = fn; } } },
    },
    MutationObserver: class { observe() {} },
    setTimeout: () => 1,
    clearTimeout() {},
    console,
  };
  vm.runInNewContext(read("src/content/content-script.js"), context);
  runtimeListener({ type: "EXTENSION_TOGGLE", active: false });
  assert.ok(removed >= 2);
}

function testMutationDuringCooldownSchedulesDeferredScan() {
  let observerCallback;
  let now = 0;
  const timers = [];
  const document = {
    readyState: "complete",
    body: {},
    getElementById: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const context = {
    self: { AutoAnswer: {
      Types: {
        MSG_TYPE: { EXTENSION_TOGGLE: "EXTENSION_TOGGLE" },
        QUESTION_TYPE: {},
        ANSWER_SOURCE: { FAILED: "failed" },
      },
      Matcher: {},
      Annotator: {},
    } },
    document,
    chrome: {
      storage: {
        sync: { get: (_keys, callback) => callback({ extensionEnabled: true }), set() {} },
        onChanged: { addListener() {} },
      },
      runtime: { onMessage: { addListener() {} }, sendMessage() {} },
    },
    MutationObserver: class {
      constructor(callback) { observerCallback = callback; }
      observe() {}
    },
    setTimeout: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimeout() {},
    Date: { now: () => now },
    console,
  };
  vm.runInNewContext(read("src/content/content-script.js"), context);
  assert.equal(timers[0].delay, 500);
  now = 1000;
  timers[0].callback();
  now = 1100;
  observerCallback([{ addedNodes: [{ nodeType: 1, className: "question-dynamic", id: "" }] }]);
  assert.equal(timers[timers.length - 1].delay, 2900);
}

(async () => {
  testAnswerNormalization();
  await testPublicSearchUsesSharedNormalizer();
  await testExactMatchSkipsFuzzySearch();
  await testConsensusAndMetrics();
  testMaterialCitationFormatting();
  await testMaterialParserHelpers();
  await testReferenceOnlyFromServiceWorker();
  await testConflictWarning();
  await testQuestionConcurrencyLimit();
  testMultipleChoiceAnnotationAndEscaping();
  testReferenceOnlyAnnotationEscapesHtml();
  testDisableClearsAnnotations();
  testMutationDuringCooldownSchedulesDeferredScan();
  console.log("All extension regression tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
