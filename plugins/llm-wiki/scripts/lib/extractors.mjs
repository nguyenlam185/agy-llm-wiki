import { execFile } from "node:child_process";
import { copyFile, open, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_MARKITDOWN_TIMEOUT_MS = 180_000;
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

const BINARY_SIGNATURES = [
  { bytes: [0x50, 0x4b, 0x03, 0x04], format: "zip" },
  { bytes: [0x25, 0x50, 0x44, 0x46], format: "pdf" },
  { bytes: [0x37, 0x7a, 0xbc, 0xaf], format: "7z" },
  { bytes: [0x1f, 0x8b], format: "gzip" },
  { bytes: [0x89, 0x50, 0x4e, 0x47], format: "png" },
  { bytes: [0xff, 0xd8, 0xff], format: "jpeg" },
  { bytes: [0x47, 0x49, 0x46, 0x38], format: "gif" },
  { bytes: [0x42, 0x4d], format: "bmp" },
  { bytes: [0x49, 0x49, 0x2a, 0x00], format: "tiff" },
  { bytes: [0x4d, 0x4d, 0x00, 0x2a], format: "tiff" },
  { bytes: [0x52, 0x49, 0x46, 0x46], format: "riff" },
  { bytes: [0x4d, 0x5a], format: "exe" },
  { bytes: [0xcf, 0xfa, 0xed, 0xfe], format: "macho" },
  { bytes: [0xce, 0xfa, 0xed, 0xfe], format: "macho" },
  { bytes: [0xfe, 0xed, 0xfa, 0xcf], format: "macho" },
  { bytes: [0xfe, 0xed, 0xfa, 0xce], format: "macho" },
  { bytes: [0xca, 0xfe, 0xba, 0xbe], format: "class" },
  { bytes: [0x7f, 0x45, 0x4c, 0x46], format: "elf" },
  { bytes: [0x00, 0x61, 0x73, 0x6d], format: "wasm" },
  { bytes: [0x53, 0x51, 0x4c, 0x69], format: "sqlite" },
  { bytes: [0x49, 0x44, 0x33], format: "mp3" },
];

export async function detectBinaryMagicBytes(filePath) {
  let handle;
  try {
    handle = await open(filePath, "r");
    const buf = Buffer.alloc(8);
    const { bytesRead } = await handle.read(buf, 0, 8, 0);
    const header = buf.subarray(0, bytesRead);
    for (const { bytes, format } of BINARY_SIGNATURES) {
      if (header.length >= bytes.length && bytes.every((b, i) => header[i] === b)) {
        return format;
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

export function binaryExtractionFailureMessage(format) {
  return `_Binary file could not be converted to markdown (detected format: ${format}).\nCapture a text-based version or a URL pointing to readable content instead._\n`;
}

export function pdfExtractionFailureMessage(source) {
  return `_PDF content could not be converted to markdown from ${source}. Ensure pdftotext or markitdown is available._\n`;
}

export function docxExtractionFailureMessage(source) {
  return `_DOCX content could not be converted to markdown from ${source}. Ensure markitdown or python3 is available._\n`;
}

function markitdownTimeoutMs() {
  const raw = process.env.WIKI_MARKITDOWN_TIMEOUT_MS;
  if (!raw) return DEFAULT_MARKITDOWN_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MARKITDOWN_TIMEOUT_MS;
}

async function runCmd(command, args, timeout) {
  try {
    const { stdout } = await execFileAsync(command, args, {
      timeout,
      maxBuffer: 32 * 1024 * 1024,
      encoding: "utf8",
    });
    return stdout?.trim() ? stdout : "";
  } catch {
    return "";
  }
}

async function extractWithDirectMarkItDown(sourcePath) {
  return runCmd("markitdown", [sourcePath], markitdownTimeoutMs());
}

async function extractWithUvxMarkItDown(sourcePath) {
  const uvxCheck = await runCmd("uvx", ["--version"], 5_000);
  if (!uvxCheck) return "";
  return runCmd(
    "uvx",
    ["--from", "markitdown[docx,pdf]", "markitdown", sourcePath],
    markitdownTimeoutMs(),
  );
}

export async function extractPdf(filePath) {
  const viaMd = await extractWithDirectMarkItDown(filePath);
  if (viaMd) return { extracted: viaMd, extractor: "markitdown", extraction_status: "success" };

  const viaPdftotext = await runCmd("pdftotext", ["-layout", filePath, "-"], 60_000);
  if (viaPdftotext) {
    return { extracted: viaPdftotext, extractor: "pdftotext", extraction_status: "success" };
  }

  const viaUvx = await extractWithUvxMarkItDown(filePath);
  if (viaUvx) return { extracted: viaUvx, extractor: "markitdown", extraction_status: "success" };

  return {
    extracted: pdfExtractionFailureMessage(filePath),
    extractor: "none",
    extraction_status: "failed",
  };
}

const PYTHON_DOCX_SCRIPT = [
  "import sys, zipfile, xml.etree.ElementTree as ET",
  "ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}",
  "with zipfile.ZipFile(sys.argv[1]) as z:",
  "    xml_bytes = z.read('word/document.xml')",
  "root = ET.fromstring(xml_bytes)",
  "paras = []",
  "for p in root.findall('.//w:p', ns):",
  "    texts = [t.text for t in p.findall('.//w:t', ns) if t.text]",
  "    if texts: paras.append(''.join(texts))",
  "print('\\n\\n'.join(paras))",
].join("\n");

export async function extractDocx(filePath) {
  const viaMd = await extractWithDirectMarkItDown(filePath);
  if (viaMd) return { extracted: viaMd, extractor: "markitdown", extraction_status: "success" };

  const viaPython = await runCmd("python3", ["-c", PYTHON_DOCX_SCRIPT, filePath], 30_000);
  if (viaPython) {
    return { extracted: viaPython, extractor: "python-zipfile", extraction_status: "success" };
  }

  const viaUvx = await extractWithUvxMarkItDown(filePath);
  if (viaUvx) return { extracted: viaUvx, extractor: "markitdown", extraction_status: "success" };

  return {
    extracted: docxExtractionFailureMessage(filePath),
    extractor: "none",
    extraction_status: "failed",
  };
}

export function decodeHtmlEntities(text) {
  return String(text ?? "").replace(/&(?:amp|lt|gt|quot|apos|nbsp|#x[0-9a-f]+|#\d+);/gi, (entity) => {
    const map = {
      "&amp;": "&",
      "&lt;": "<",
      "&gt;": ">",
      "&quot;": '"',
      "&apos;": "'",
      "&nbsp;": " ",
    };
    const lower = entity.toLowerCase();
    if (map[lower]) return map[lower];
    if (lower.startsWith("&#x")) {
      const code = Number.parseInt(lower.slice(3, -1), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
    }
    if (lower.startsWith("&#")) {
      const code = Number.parseInt(lower.slice(2, -1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
    }
    return entity;
  });
}

function stripHtmlTags(s) {
  return decodeHtmlEntities(String(s ?? "").replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Pure-JS HTML-to-Markdown converter preserving headings, code blocks, links, lists, and tables. */
export function htmlToMarkdown(input) {
  const raw = String(input ?? "");
  const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1]).replace(/\s+/g, " ").trim() : "";

  let html = raw.replace(/<head\b[\s\S]*?<\/head>/gi, "");
  let prev = "";
  while (prev !== html) {
    prev = html;
    html = html.replace(/<(script|style|nav|header|footer|noscript|svg)\b[\s\S]*?<\/\1>/gi, "");
  }

  // Extract <pre> blocks first so code formatting survives inline stripping.
  const codePlaceholders = [];
  html = html.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_full, inner) => {
    const codeText = decodeHtmlEntities(inner.replace(/<\/?code\b[^>]*>/gi, "")).replace(/^\n+|\n+$/g, "");
    const idx = codePlaceholders.length;
    codePlaceholders.push(`\n\n\`\`\`\n${codeText}\n\`\`\`\n\n`);
    return `@@CODE_BLOCK_${idx}@@`;
  });

  // Tables
  html = html.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_full, tableInner) => {
    const rows = [];
    for (const trMatch of tableInner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [];
      for (const cellMatch of trMatch[1].matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
        cells.push(stripHtmlTags(cellMatch[2]).replace(/\|/g, "\\|"));
      }
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length === 0) return "";
    const width = Math.max(...rows.map((r) => r.length));
    const norm = rows.map((r) => [...r, ...Array(width - r.length).fill("")]);
    const header = `| ${norm[0].join(" | ")} |`;
    const sep = `| ${Array(width).fill("---").join(" | ")} |`;
    const body = norm.slice(1).map((r) => `| ${r.join(" | ")} |`);
    return `\n\n${[header, sep, ...body].join("\n")}\n\n`;
  });

  const hasBodyH1 = /<h1\b[^>]*>[\s\S]*?<\/h1>/i.test(html);

  html = html
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, lvl, inner) => {
      const text = stripHtmlTags(inner);
      return text ? `\n\n${"#".repeat(Number(lvl))} ${text}\n\n` : "";
    })
    .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner) => {
      const text = stripHtmlTags(inner);
      return text ? `\n\n> ${text.replace(/\n/g, "\n> ")}\n\n` : "";
    })
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, inner) => {
      const label = stripHtmlTags(inner) || href;
      return `[${label}](${href})`;
    })
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner) => `**${stripHtmlTags(inner)}**`)
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner) => `*${stripHtmlTags(inner)}*`)
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_m, inner) => `\`${stripHtmlTags(inner)}\``)
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner) => {
      const text = stripHtmlTags(inner);
      return text ? `\n- ${text}` : "";
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<hr\s*\/?>/gi, "\n\n---\n\n")
    .replace(/<\/(?:p|div|section|article|ul|ol|dl|dt|dd)>/gi, "\n\n");

  let text = html.replace(/<[^>]+>/g, "");
  text = decodeHtmlEntities(text);
  text = text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  for (let i = 0; i < codePlaceholders.length; i++) {
    text = text.replace(`@@CODE_BLOCK_${i}@@`, codePlaceholders[i].trim());
  }

  if (!text) return raw;
  if (title && !hasBodyH1) {
    return `# ${title}\n\n${text}`;
  }
  return text;
}

export function xmlToMarkdown(xml) {
  let title = "";
  const titleMatch = String(xml).match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleMatch) title = titleMatch[1].trim();

  let text = String(xml)
    .replace(/<\?xml[^>]*\?>\s*/gi, "")
    .replace(/<!DOCTYPE[^>]*>\s*/gi, "")
    .replace(/<\/(p|div|section|article|li|h\d|tr|blockquote|pre)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");

  let prev = "";
  while (prev !== text) {
    prev = text;
    text = text.replace(/<[a-zA-Z/!?][^>]*>/g, "");
  }
  text = decodeHtmlEntities(text.replace(/</g, ""))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return String(xml);

  const lines = [];
  if (title) lines.push(`# ${title}`);
  lines.push(text);
  return lines.join("\n\n");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function titleFromValue(value) {
  if (!isRecord(value)) return undefined;
  for (const key of ["title", "name", "id"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

function humanizeKey(key) {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (ch) => ch.toUpperCase());
}

export function jsonToMarkdown(json) {
  let value;
  try {
    value = JSON.parse(json);
  } catch {
    return json;
  }

  const lines = [];
  const title = titleFromValue(value) || "JSON Extract";
  lines.push(`# ${title}`, "");

  function renderValue(val, depth, label) {
    const indent = "  ".repeat(Math.max(0, depth));
    const heading = "#".repeat(Math.min(depth + 2, 6));
    if (Array.isArray(val)) {
      if (label) lines.push(`${heading} ${humanizeKey(label)}`, "");
      if (val.length === 0) {
        lines.push(`${indent}- _(empty)_`, "");
        return;
      }
      for (const [idx, item] of val.entries()) {
        if (isRecord(item)) {
          const itemTitle = titleFromValue(item) || `Item ${idx + 1}`;
          const itemDepth = label ? depth + 1 : depth;
          lines.push(`${"#".repeat(Math.min(itemDepth + 2, 6))} ${itemTitle}`, "");
          renderObject(item, itemDepth);
        } else if (Array.isArray(item)) {
          lines.push(`${indent}- Item ${idx + 1}:`);
          renderValue(item, depth + 1);
        } else {
          lines.push(`${indent}- ${String(item)}`);
        }
      }
      lines.push("");
      return;
    }
    if (isRecord(val)) {
      renderObject(val, depth, label);
      return;
    }
    if (label) lines.push(`${indent}- **${humanizeKey(label)}:** ${String(val)}`);
    else lines.push(`${indent}- ${String(val)}`);
  }

  function renderObject(obj, depth, label) {
    const indent = "  ".repeat(Math.max(0, depth));
    const heading = "#".repeat(Math.min(depth + 2, 6));
    if (label) lines.push(`${heading} ${humanizeKey(label)}`, "");
    for (const [k, v] of Object.entries(obj)) {
      if (Array.isArray(v) || isRecord(v)) {
        renderValue(v, label ? depth + 1 : depth, k);
      } else {
        lines.push(`${indent}- **${humanizeKey(k)}:** ${String(v)}`);
      }
    }
    lines.push("");
  }

  renderValue(value, 0);
  return (
    lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() || json
  );
}

function titleFromMarkdown(md) {
  return String(md).match(/^#\s+(.+)$/m)?.[1]?.trim();
}

function titleFromHtml(html) {
  const m = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeHtmlEntities(m[1]).replace(/\s+/g, " ").trim() : undefined;
}

export async function extractLocalFile(filePath, originalDir) {
  const fileName = basename(filePath) || "source";
  const ext = extname(fileName).toLowerCase();
  const destOriginal = join(originalDir, fileName);

  await copyFile(filePath, destOriginal);

  if (ext === ".pdf") {
    const res = await extractPdf(destOriginal);
    return { ...res, title: titleFromMarkdown(res.extracted) ?? fileName, format: "pdf", content_type: "application/pdf" };
  }
  if (ext === ".docx") {
    const res = await extractDocx(destOriginal);
    return {
      ...res,
      title: titleFromMarkdown(res.extracted) ?? fileName,
      format: "docx",
      content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  }
  if (ext === ".md" || ext === ".markdown") {
    const text = await readFile(filePath, "utf8");
    return { extracted: text, title: titleFromMarkdown(text) ?? fileName, format: "markdown", extractor: "passthrough", extraction_status: "success", content_type: "text/markdown" };
  }
  if (ext === ".txt") {
    const text = await readFile(filePath, "utf8");
    return { extracted: text, title: fileName, format: "text", extractor: "passthrough", extraction_status: "success", content_type: "text/plain" };
  }
  if (ext === ".html" || ext === ".htm") {
    const html = await readFile(filePath, "utf8");
    const md = htmlToMarkdown(html);
    return { extracted: md, title: titleFromMarkdown(md) ?? titleFromHtml(html) ?? fileName, format: "html", extractor: "htmlToMarkdown", extraction_status: "success", content_type: "text/html" };
  }
  if (ext === ".xml") {
    const xml = await readFile(filePath, "utf8");
    const md = xmlToMarkdown(xml);
    return { extracted: md, title: titleFromMarkdown(md) ?? fileName, format: "xml", extractor: "xmlToMarkdown", extraction_status: "success", content_type: "application/xml" };
  }
  if (ext === ".json") {
    const raw = await readFile(filePath, "utf8");
    const md = jsonToMarkdown(raw);
    return { extracted: md, title: titleFromMarkdown(md) ?? fileName, format: "json", extractor: "jsonToMarkdown", extraction_status: "success", content_type: "application/json" };
  }

  const binaryFormat = await detectBinaryMagicBytes(filePath);
  if (binaryFormat) {
    return {
      extracted: binaryExtractionFailureMessage(binaryFormat),
      title: fileName,
      format: "file",
      extractor: "magicBytes",
      extraction_status: "unsupported",
    };
  }

  const text = await readFile(filePath, "utf8");
  return {
    extracted: text,
    title: titleFromMarkdown(text) ?? fileName,
    format: "file",
    extractor: "passthrough",
    extraction_status: "success",
  };
}

const URL_EXTS = new Set([".html", ".htm", ".md", ".pdf", ".txt", ".xml", ".json"]);

export async function extractUrl(url, originalDir) {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
    headers: { "User-Agent": "llm-wiki-cli/0.1" },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  const buf = Buffer.from(await response.arrayBuffer());
  let ext = ".html";
  try {
    const candidateExt = extname(new URL(url).pathname).toLowerCase();
    if (URL_EXTS.has(candidateExt)) ext = candidateExt;
  } catch {
    // ignore malformed URL path
  }

  const isPdf =
    contentType.includes("application/pdf") ||
    ext === ".pdf" ||
    buf.subarray(0, 5).toString("latin1") === "%PDF-";

  if (isPdf) {
    const pdfPath = join(originalDir, "source.pdf");
    await writeFile(pdfPath, buf);
    const res = await extractPdf(pdfPath);
    return {
      ...res,
      title: titleFromMarkdown(res.extracted) ?? url,
      format: "web",
      content_type: "application/pdf",
    };
  }

  const rawText = buf.toString("utf8");
  if (contentType.includes("application/json") || ext === ".json") {
    await writeFile(join(originalDir, "source.json"), rawText, "utf8");
    const md = jsonToMarkdown(rawText);
    return {
      extracted: md,
      title: titleFromMarkdown(md) ?? url,
      format: "web",
      extractor: "jsonToMarkdown",
      extraction_status: "success",
      content_type: "application/json",
    };
  }

  if (contentType.includes("application/xml") || contentType.includes("text/xml") || ext === ".xml") {
    await writeFile(join(originalDir, "source.xml"), rawText, "utf8");
    const md = xmlToMarkdown(rawText);
    return {
      extracted: md,
      title: titleFromMarkdown(md) ?? url,
      format: "web",
      extractor: "xmlToMarkdown",
      extraction_status: "success",
      content_type: "application/xml",
    };
  }

  if (contentType.includes("text/markdown") || contentType.includes("text/plain") || ext === ".md" || ext === ".txt") {
    await writeFile(join(originalDir, `source${ext === ".md" ? ".md" : ".txt"}`), rawText, "utf8");
    return {
      extracted: rawText,
      title: titleFromMarkdown(rawText) ?? url,
      format: "web",
      extractor: "passthrough",
      extraction_status: "success",
      content_type: contentType.split(";")[0] || "text/plain",
    };
  }

  await writeFile(join(originalDir, "source.html"), rawText, "utf8");
  const md = htmlToMarkdown(rawText);
  return {
    extracted: md,
    title: titleFromMarkdown(md) ?? titleFromHtml(rawText) ?? url,
    format: "web",
    extractor: "htmlToMarkdown",
    extraction_status: "success",
    content_type: "text/html",
  };
}
