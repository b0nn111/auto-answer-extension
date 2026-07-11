import * as pdfjsLib from "../../vendor/pdfjs/pdf.min.mjs";

const root = globalThis;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MIN_READABLE_TEXT = 20;
const PARSER_VERSION = 2;

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
    throw new MaterialParseError("INVALID_FILE", "无法读取所选文件");
  }
  if (Number(file.size || 0) > MAX_FILE_BYTES) {
    throw new MaterialParseError("FILE_TOO_LARGE", "单个资料文件不能超过 50 MB");
  }

  const format = detectFormat(file);
  if (format === "pdf") return parsePdf(file);
  if (format === "docx") return parseDocx(file);
  if (format === "text") return parseText(file);
  throw new MaterialParseError("UNSUPPORTED_FORMAT", "不支持这种文件格式");
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
        "未检测到可提取文字，1.3.0 暂不支持扫描件 OCR"
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
    throw new MaterialParseError("PARSER_NOT_READY", "Word 解析器尚未加载完成，请稍后重试");
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
      throw new MaterialParseError("NO_EXTRACTABLE_TEXT", "Word 文档中没有可提取的文字");
    }
    const warnings = (result.messages || [])
      .map((item) => String(item.message || "").trim())
      .filter(Boolean);
    return makeDocument("docx", blocks, null, warnings);
  } catch (error) {
    if (error instanceof MaterialParseError) throw error;
    throw new MaterialParseError("INVALID_DOCX", "Word 文档损坏或无法解析", error);
  }
}

async function parseText(file) {
  try {
    const text = normalizeText(await file.text());
    if (!text) throw new MaterialParseError("NO_EXTRACTABLE_TEXT", "文件中没有可读取的文字");
    return makeDocument("text", textToBlocks(text), null, []);
  } catch (error) {
    if (error instanceof MaterialParseError) throw error;
    throw new MaterialParseError("TEXT_READ_FAILED", "文本文件读取失败", error);
  }
}

function detectFormat(file) {
  const name = String(file.name || "").toLowerCase();
  const type = String(file.type || "").toLowerCase();
  if (name.endsWith(".pdf") || type === "application/pdf") return "pdf";
  if (name.endsWith(".docx") || type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (isSupportedTextFile(name, type)) return "text";
  return "unsupported";
}

function isSupportedTextFile(name, type) {
  return /\.(txt|md|markdown|json|csv|tsv|html|htm|xml|js|ts|jsx|tsx|py|java|c|cpp|h|hpp|cs|go|rs|php|rb|sql|yaml|yml|ini|log)$/i.test(name) ||
    /^text\//.test(type) ||
    type === "application/json" ||
    type === "application/xml";
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
  if (/^[,.;:!?%)\]}，。；：！？、]/.test(next)) return false;
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

function mapPdfError(error) {
  const name = String(error?.name || "");
  const message = String(error?.message || "");
  if (name === "PasswordException" || /password/i.test(message)) {
    return new MaterialParseError("PDF_ENCRYPTED", "PDF 已加密，请先移除密码", error);
  }
  if (name === "InvalidPDFException" || /invalid pdf/i.test(message)) {
    return new MaterialParseError("INVALID_PDF", "PDF 文件损坏或格式无效", error);
  }
  return new MaterialParseError("PDF_PARSE_FAILED", "PDF 解析失败", error);
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
  parseDocx,
  parseFile,
  parsePdf,
  parseText,
  pdfTextContentToText,
};
