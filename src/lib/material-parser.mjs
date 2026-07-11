import * as pdfjsLib from "../../vendor/pdfjs/pdf.min.mjs";

const root = globalThis;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MIN_READABLE_TEXT = 20;
const PARSER_VERSION = 3;

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "../../vendor/pdfjs/pdf.worker.min.mjs",
  import.meta.url
).href;

class MaterialParseError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "MaterialParseError";
    this.code = code;
  }
}

async function parseFile(file) {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new MaterialParseError("INVALID_FILE", "\u65e0\u6cd5\u8bfb\u53d6\u6240\u9009\u6587\u4ef6");
  }
  if (Number(file.size || 0) > MAX_FILE_BYTES) {
    throw new MaterialParseError("FILE_TOO_LARGE", "\u5355\u4e2a\u8d44\u6599\u6587\u4ef6\u4e0d\u80fd\u8d85\u8fc7 50 MB");
  }

  const format = detectFormat(file);
  if (format === "pdf") return parsePdf(file);
  if (format === "docx") return parseDocx(file);
  if (format === "pptx") return parsePptx(file);
  if (format === "spreadsheet") return parseSpreadsheet(file);
  if (format === "text") return parseText(file);
  throw new MaterialParseError("UNSUPPORTED_FORMAT", unsupportedFormatMessage(file));
}

async function parsePdf(file) {
  let loadingTask = null;
  let documentHandle = null;
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    loadingTask = pdfjsLib.getDocument({
      data,
      isEvalSupported: false,
      useSystemFonts: true,
    });
    documentHandle = await loadingTask.promise;

    const blocks = [];
    for (let pageNumber = 1; pageNumber <= documentHandle.numPages; pageNumber++) {
      const page = await documentHandle.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = pdfTextContentToText(content);
      if (text) {
        blocks.push({
          text,
          markdown: text,
          locatorType: "page",
          pageNumber,
          headingPath: [],
          paragraphStart: null,
          paragraphEnd: null,
        });
      }
      page.cleanup();
    }

    const readableLength = blocks.reduce((sum, block) => sum + block.text.length, 0);
    if (readableLength < MIN_READABLE_TEXT) {
      throw new MaterialParseError(
        "NO_EXTRACTABLE_TEXT",
        "\u672a\u68c0\u6d4b\u5230\u53ef\u63d0\u53d6\u6587\u5b57\uff0c\u6682\u4e0d\u652f\u6301\u626b\u63cf\u4ef6 PDF OCR"
      );
    }
    return makeDocument("pdf", blocks, documentHandle.numPages, []);
  } catch (error) {
    if (error instanceof MaterialParseError) throw error;
    throw mapPdfError(error);
  } finally {
    await cleanupPdfDocument(loadingTask, documentHandle);
  }
}

async function cleanupPdfDocument(loadingTask, documentHandle) {
  if (loadingTask && typeof loadingTask.destroy === "function") {
    await loadingTask.destroy().catch(() => {});
    return;
  }
  if (documentHandle && typeof documentHandle.destroy === "function") {
    await documentHandle.destroy().catch(() => {});
    return;
  }
  if (documentHandle && typeof documentHandle.cleanup === "function") {
    documentHandle.cleanup();
  }
}

async function parseDocx(file) {
  const mammoth = root.mammoth;
  const TurndownService = root.TurndownService;
  if (!mammoth || !TurndownService) {
    throw new MaterialParseError("PARSER_NOT_READY", "Word \u89e3\u6790\u5668\u5c1a\u672a\u52a0\u8f7d\u5b8c\u6210\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5");
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml(
      { arrayBuffer },
      { convertImage: mammoth.images.imgElement(() => ({})) }
    );
    const turndown = new TurndownService({
      headingStyle: "atx",
      bulletListMarker: "-",
      codeBlockStyle: "fenced",
    });
    turndown.remove(["script", "style", "img"]);
    const markdown = normalizeMarkdown(turndown.turndown(result.value || ""));
    const blocks = markdownToBlocks(markdown);
    const readableLength = blocks.reduce((sum, block) => sum + block.text.length, 0);
    if (readableLength < MIN_READABLE_TEXT) {
      throw new MaterialParseError("NO_EXTRACTABLE_TEXT", "Word \u6587\u6863\u4e2d\u6ca1\u6709\u53ef\u63d0\u53d6\u7684\u6587\u5b57");
    }
    const warnings = (result.messages || [])
      .map((item) => String(item.message || "").trim())
      .filter(Boolean);
    return makeDocument("docx", blocks, null, warnings);
  } catch (error) {
    if (error instanceof MaterialParseError) throw error;
    throw new MaterialParseError("INVALID_DOCX", "Word \u6587\u6863\u635f\u574f\u6216\u65e0\u6cd5\u89e3\u6790", error);
  }
}

async function parsePptx(file) {
  try {
    const entries = await unzipOfficeXml(await file.arrayBuffer());
    const slideNames = Object.keys(entries)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .sort(naturalSort);
    const blocks = [];
    for (const name of slideNames) {
      const slideNumber = Number((name.match(/slide(\d+)\.xml$/i) || [])[1] || blocks.length + 1);
      const text = xmlTextRuns(entries[name]).join("\n").trim();
      if (!text) continue;
      blocks.push({
        text,
        markdown: "# Slide " + slideNumber + "\n\n" + text,
        locatorType: "page",
        pageNumber: slideNumber,
        headingPath: ["Slide " + slideNumber],
        paragraphStart: null,
        paragraphEnd: null,
      });
    }
    const readableLength = blocks.reduce((sum, block) => sum + block.text.length, 0);
    if (readableLength < MIN_READABLE_TEXT) {
      throw new MaterialParseError("NO_EXTRACTABLE_TEXT", "PPTX \u4e2d\u6ca1\u6709\u53ef\u63d0\u53d6\u7684\u6587\u5b57");
    }
    return makeDocument("pptx", blocks, slideNames.length, []);
  } catch (error) {
    if (error instanceof MaterialParseError) throw error;
    throw new MaterialParseError("INVALID_PPTX", "PPTX \u6587\u4ef6\u635f\u574f\u6216\u65e0\u6cd5\u89e3\u6790", error);
  }
}

async function parseSpreadsheet(file) {
  const name = String(file.name || "").toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".tsv")) {
    const delimiter = name.endsWith(".tsv") ? "\t" : ",";
    return makeSpreadsheetDocument(file.name || "Sheet1", parseDelimitedRows(await file.text(), delimiter));
  }
  if (!name.endsWith(".xlsx")) {
    throw new MaterialParseError("UNSUPPORTED_FORMAT", unsupportedFormatMessage(file));
  }
  try {
    const entries = await unzipOfficeXml(await file.arrayBuffer());
    const sharedStrings = parseSharedStrings(entries["xl/sharedStrings.xml"] || "");
    const sheets = parseWorkbookSheets(entries);
    const blocks = [];
    for (const sheet of sheets) {
      const xml = entries[sheet.path];
      if (!xml) continue;
      blocks.push(...spreadsheetRowsToBlocks(sheet.name, parseWorksheetRows(xml, sharedStrings)));
    }
    const readableLength = blocks.reduce((sum, block) => sum + block.text.length, 0);
    if (readableLength < MIN_READABLE_TEXT) {
      throw new MaterialParseError("NO_EXTRACTABLE_TEXT", "\u8868\u683c\u4e2d\u6ca1\u6709\u53ef\u63d0\u53d6\u7684\u6587\u5b57");
    }
    return makeDocument("spreadsheet", blocks, null, []);
  } catch (error) {
    if (error instanceof MaterialParseError) throw error;
    throw new MaterialParseError("INVALID_XLSX", "XLSX \u8868\u683c\u635f\u574f\u6216\u65e0\u6cd5\u89e3\u6790", error);
  }
}

async function parseText(file) {
  try {
    const text = normalizeText(await file.text());
    if (!text) throw new MaterialParseError("NO_EXTRACTABLE_TEXT", "\u6587\u4ef6\u4e2d\u6ca1\u6709\u53ef\u8bfb\u53d6\u7684\u6587\u5b57");
    return makeDocument("text", textToBlocks(text), null, []);
  } catch (error) {
    if (error instanceof MaterialParseError) throw error;
    throw new MaterialParseError("TEXT_READ_FAILED", "\u6587\u672c\u6587\u4ef6\u8bfb\u53d6\u5931\u8d25", error);
  }
}

function detectFormat(file) {
  const name = String(file.name || "").toLowerCase();
  const type = String(file.type || "").toLowerCase();
  if (name.endsWith(".pdf") || type === "application/pdf") return "pdf";
  if (name.endsWith(".docx") || type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (name.endsWith(".pptx") || type === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return "pptx";
  if (/\.(xlsx|csv|tsv)$/i.test(name) ||
    type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    type === "text/csv" ||
    type === "text/tab-separated-values") return "spreadsheet";
  if (isSupportedTextFile(name, type)) return "text";
  return "unsupported";
}

function isSupportedTextFile(name, type) {
  return /\.(txt|md|markdown|json|html|htm|xml|js|ts|jsx|tsx|py|java|c|cpp|h|hpp|cs|go|rs|php|rb|sql|yaml|yml|ini|log)$/i.test(name) ||
    /^text\//.test(type) ||
    type === "application/json" ||
    type === "application/xml";
}

function unsupportedFormatMessage(file) {
  const name = String(file?.name || "").toLowerCase();
  if (name.endsWith(".ppt")) return "\u6682\u4e0d\u652f\u6301 PPT \u8001\u683c\u5f0f .ppt\uff0c\u8bf7\u53e6\u5b58\u4e3a .pptx";
  if (name.endsWith(".xls")) return "\u6682\u4e0d\u652f\u6301 Excel \u8001\u683c\u5f0f .xls\uff0c\u8bf7\u53e6\u5b58\u4e3a .xlsx \u6216 .csv";
  return "\u4e0d\u652f\u6301\u8fd9\u79cd\u6587\u4ef6\u683c\u5f0f\u3002\u5df2\u652f\u6301\uff1aPDF\u3001DOCX\u3001PPTX\u3001XLSX\u3001CSV\u3001TSV\u3001TXT";
}

function pdfTextContentToText(content) {
  const lines = [];
  let line = "";
  let previousY = null;
  let previousEndX = null;

  const flushLine = () => {
    const clean = line.replace(/[ \u00a0]+/g, " ").trim();
    if (clean) lines.push(clean);
    line = "";
    previousEndX = null;
  };

  for (const item of content?.items || []) {
    const value = String(item?.str || "").trim();
    if (!value) {
      if (item?.hasEOL) flushLine();
      continue;
    }
    const x = Number(item?.transform?.[4]);
    const y = Number(item?.transform?.[5]);
    if (line && Number.isFinite(y) && Number.isFinite(previousY) && Math.abs(y - previousY) > 2.5) {
      flushLine();
    }
    if (line && needsSpace(line, value, x, previousEndX)) line += " ";
    line += value;
    previousY = Number.isFinite(y) ? y : previousY;
    previousEndX = Number.isFinite(x) ? x + Number(item?.width || 0) : null;
    if (item?.hasEOL) flushLine();
  }
  flushLine();
  return normalizeText(lines.join("\n"));
}

function needsSpace(current, next, x, previousEndX) {
  if (/\s$/.test(current) || /^\s/.test(next)) return false;
  if (/[\u4e00-\u9fff]$/.test(current) && /^[\u4e00-\u9fff]/.test(next)) return false;
  if (/^[,.;:!?%)\]}\u3001\u3002\uff1b\uff1a\uff01\uff1f\u300d]/.test(next)) return false;
  if (Number.isFinite(x) && Number.isFinite(previousEndX)) return x - previousEndX > 0.5;
  return true;
}

function markdownToBlocks(markdown) {
  const lines = normalizeMarkdown(markdown).split("\n");
  const blocks = [];
  const headingPath = [];
  let buffer = [];
  let paragraphIndex = 0;

  const flush = () => {
    const blockMarkdown = buffer.join("\n").trim();
    buffer = [];
    if (!blockMarkdown) return;
    const text = markdownToPlainText(blockMarkdown);
    if (!text) return;
    paragraphIndex++;
    blocks.push({
      text,
      markdown: blockMarkdown,
      locatorType: headingPath.length ? "heading" : "paragraph",
      pageNumber: null,
      headingPath: headingPath.slice(),
      paragraphStart: paragraphIndex,
      paragraphEnd: paragraphIndex,
    });
  };

  lines.forEach((line) => {
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      flush();
      const level = heading[1].length;
      headingPath.length = level - 1;
      headingPath[level - 1] = markdownToPlainText(heading[2]);
      return;
    }
    if (!line.trim()) flush();
    else buffer.push(line);
  });
  flush();

  if (!blocks.length) {
    const text = markdownToPlainText(markdown);
    if (text) {
      blocks.push({
        text,
        markdown: normalizeMarkdown(markdown),
        locatorType: "paragraph",
        pageNumber: null,
        headingPath: [],
        paragraphStart: 1,
        paragraphEnd: 1,
      });
    }
  }
  return blocks;
}

function textToBlocks(text) {
  const paragraphs = normalizeText(text).split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  return paragraphs.map((paragraph, index) => ({
    text: paragraph,
    markdown: paragraph,
    locatorType: "paragraph",
    pageNumber: null,
    headingPath: [],
    paragraphStart: index + 1,
    paragraphEnd: index + 1,
  }));
}

function makeSpreadsheetDocument(sheetName, rows) {
  const blocks = spreadsheetRowsToBlocks(sheetName || "Sheet1", rows);
  const readableLength = blocks.reduce((sum, block) => sum + block.text.length, 0);
  if (readableLength < MIN_READABLE_TEXT) {
    throw new MaterialParseError("NO_EXTRACTABLE_TEXT", "\u8868\u683c\u4e2d\u6ca1\u6709\u53ef\u63d0\u53d6\u7684\u6587\u5b57");
  }
  return makeDocument("spreadsheet", blocks, null, []);
}

function spreadsheetRowsToBlocks(sheetName, rows) {
  const cleanRows = rows
    .map((row) => row.map((cell) => normalizeInlineText(cell)).filter(Boolean))
    .filter((row) => row.length);
  const blocks = [];
  for (let start = 0; start < cleanRows.length; start += 40) {
    const part = cleanRows.slice(start, start + 40);
    const markdown = part.map((row, index) =>
      "Row " + (start + index + 1) + ": " + row.join(" | ")
    ).join("\n");
    blocks.push({
      text: markdown,
      markdown,
      locatorType: "heading",
      pageNumber: null,
      headingPath: [sheetName],
      paragraphStart: start + 1,
      paragraphEnd: start + part.length,
    });
  }
  return blocks;
}

function parseDelimitedRows(text, delimiter) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  const source = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') {
        value += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        value += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(value);
      value = "";
    } else if (ch === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += ch;
    }
  }
  row.push(value);
  if (row.some((cell) => String(cell || "").trim())) rows.push(row);
  return rows;
}

async function unzipOfficeXml(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const entries = parseZipDirectory(bytes);
  const result = {};
  for (const entry of entries) {
    if (!/\.(xml|rels)$/i.test(entry.name)) continue;
    const compressed = bytes.slice(entry.dataStart, entry.dataStart + entry.compressedSize);
    const data = await inflateZipEntry(compressed, entry.method);
    result[entry.name] = new TextDecoder("utf-8").decode(data);
  }
  return result;
}

function parseZipDirectory(bytes) {
  const eocd = findEndOfCentralDirectory(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries = [];
  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("Invalid ZIP central directory");
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameBytes = bytes.slice(offset + 46, offset + 46 + fileNameLength);
    const name = new TextDecoder("utf-8").decode(nameBytes).replace(/\\/g, "/");
    entries.push({ name, method, compressedSize, dataStart: localDataStart(bytes, localHeaderOffset) });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function findEndOfCentralDirectory(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const min = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  throw new Error("ZIP end of central directory not found");
}

function localDataStart(bytes, offset) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(offset, true) !== 0x04034b50) throw new Error("Invalid ZIP local header");
  return offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
}

async function inflateZipEntry(data, method) {
  if (method === 0) return data;
  if (method !== 8) throw new Error("Unsupported ZIP compression method: " + method);
  if (typeof DecompressionStream !== "function") {
    throw new Error("Browser does not support ZIP decompression");
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const doc = parseXml(xml);
  return Array.from(doc.getElementsByTagNameNS("*", "si")).map((item) =>
    Array.from(item.getElementsByTagNameNS("*", "t")).map((node) => node.textContent || "").join("")
  );
}

function parseWorkbookSheets(entries) {
  const workbook = parseXml(entries["xl/workbook.xml"] || "");
  const rels = parseWorkbookRelationships(entries["xl/_rels/workbook.xml.rels"] || "");
  const sheets = Array.from(workbook.getElementsByTagNameNS("*", "sheet")).map((sheet) => {
    const name = sheet.getAttribute("name") || "Sheet";
    const rid = sheet.getAttribute("r:id") || sheet.getAttribute("id") || "";
    return { name, path: normalizeWorkbookTarget(rels[rid] || "") };
  }).filter((sheet) => sheet.path);
  if (sheets.length) return sheets;
  return Object.keys(entries)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort(naturalSort)
    .map((path, index) => ({ name: "Sheet" + (index + 1), path }));
}

function parseWorkbookRelationships(xml) {
  if (!xml) return {};
  const doc = parseXml(xml);
  const rels = {};
  Array.from(doc.getElementsByTagNameNS("*", "Relationship")).forEach((rel) => {
    rels[rel.getAttribute("Id") || ""] = rel.getAttribute("Target") || "";
  });
  return rels;
}

function normalizeWorkbookTarget(target) {
  if (!target) return "";
  const clean = target.replace(/\\/g, "/").replace(/^\//, "");
  return clean.startsWith("xl/") ? clean : "xl/" + clean.replace(/^\.\.\//, "");
}

function parseWorksheetRows(xml, sharedStrings) {
  const doc = parseXml(xml);
  return Array.from(doc.getElementsByTagNameNS("*", "row")).map((row) =>
    Array.from(row.getElementsByTagNameNS("*", "c")).map((cell) => worksheetCellValue(cell, sharedStrings))
  );
}

function worksheetCellValue(cell, sharedStrings) {
  const type = cell.getAttribute("t") || "";
  const inlineText = Array.from(cell.getElementsByTagNameNS("*", "t")).map((node) => node.textContent || "").join("");
  if (inlineText) return inlineText;
  const value = cell.getElementsByTagNameNS("*", "v")[0]?.textContent || "";
  if (type === "s") return sharedStrings[Number(value)] || "";
  if (type === "b") return value === "1" ? "TRUE" : "FALSE";
  return value;
}

function xmlTextRuns(xml) {
  const doc = parseXml(xml);
  return Array.from(doc.getElementsByTagNameNS("*", "t"))
    .map((node) => normalizeInlineText(node.textContent || ""))
    .filter(Boolean);
}

function parseXml(xml) {
  const doc = new DOMParser().parseFromString(String(xml || ""), "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("Invalid XML");
  return doc;
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

function makeDocument(format, blocks, pageCount, warnings) {
  return {
    format,
    parserVersion: PARSER_VERSION,
    pageCount: Number.isFinite(pageCount) ? pageCount : null,
    textLength: blocks.reduce((sum, block) => sum + block.text.length, 0),
    blocks,
    warnings: Array.isArray(warnings) ? warnings : [],
  };
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[ \u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeMarkdown(markdown) {
  return String(markdown || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeInlineText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function mapPdfError(error) {
  const name = String(error?.name || "");
  const message = String(error?.message || "");
  if (name === "PasswordException" || /password/i.test(message)) {
    return new MaterialParseError("PDF_ENCRYPTED", "PDF \u5df2\u52a0\u5bc6\uff0c\u8bf7\u5148\u79fb\u9664\u5bc6\u7801", error);
  }
  if (name === "InvalidPDFException" || /invalid pdf/i.test(message)) {
    return new MaterialParseError("INVALID_PDF", "PDF \u6587\u4ef6\u635f\u574f\u6216\u683c\u5f0f\u65e0\u6548", error);
  }
  return new MaterialParseError("PDF_PARSE_FAILED", "PDF \u89e3\u6790\u5931\u8d25", error);
}

const MaterialParser = {
  parseFile,
  detectFormat,
  MAX_FILE_BYTES,
  PARSER_VERSION,
};

root.AutoAnswer = root.AutoAnswer || {};
root.AutoAnswer.MaterialParser = MaterialParser;
root.dispatchEvent?.(new CustomEvent("auto-answer-material-parser-ready"));

export {
  MaterialParseError,
  MaterialParser,
  markdownToBlocks,
  markdownToPlainText,
  normalizeText,
  parseDelimitedRows,
  parseDocx,
  parseFile,
  parsePdf,
  parsePptx,
  parseSpreadsheet,
  parseText,
  pdfTextContentToText,
  spreadsheetRowsToBlocks,
};
