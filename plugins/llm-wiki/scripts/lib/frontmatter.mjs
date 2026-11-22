import { readFileSync, writeFileSync } from "node:fs";

/**
 * Zero-dependency OKF v0.2 YAML frontmatter parser, validator, and serializer.
 *
 * Enforces safety bounds (128 KB max byte length, depth <= 32), rejects YAML
 * aliases/anchors, custom tags, duplicate keys, and multiple YAML documents.
 */

export const FRONTMATTER_MAX_BYTES = 128 * 1024;
export const FRONTMATTER_MAX_DEPTH = 32;

export const RESERVED_FRONTMATTER = new Set([
  "type",
  "title",
  "created",
  "updated",
  "sources",
  "id",
]);

const STANDARD_FIELDS = [
  "type",
  "title",
  "description",
  "resource",
  "tags",
  "generated",
  "verified",
  "status",
  "stale_after",
  "category",
  "domain",
  "aliases",
  "recall_triggers",
  "created",
  "updated",
  "summary",
  "raw_path",
  "source_id",
  "sources",
];

const STANDARD_FIELD_SET = new Set(STANDARD_FIELDS);
const LEGACY_COMPAT_FIELDS = new Set(["created", "updated", "summary", "raw_path", "source_id"]);

class YamlSecurityError extends Error {
  constructor(code, message, line) {
    super(message);
    this.code = code;
    this.line = line;
  }
}

function setSafeProp(obj, key, value) {
  Object.defineProperty(obj, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function diag(severity, code, path, message, line, column) {
  return {
    severity,
    code,
    path,
    message,
    ...(line !== undefined ? { line } : {}),
    ...(column !== undefined ? { column } : {}),
  };
}

function stripInlineComment(line) {
  let quote = null;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote === '"') {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') quote = null;
    } else if (quote === "'") {
      if (ch === "'") {
        if (line[i + 1] === "'") i++;
        else quote = null;
      }
    } else {
      if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
        return line.slice(0, i).trimEnd();
      }
    }
  }
  return line.trimEnd();
}

function splitUnquotedFirstColon(text) {
  let quote = null;
  let escaped = false;
  let flowDepth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') quote = null;
      continue;
    }
    if (quote === "'") {
      if (ch === "'") {
        if (text[i + 1] === "'") i++;
        else quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "[" || ch === "{") flowDepth++;
    else if ((ch === "]" || ch === "}") && flowDepth > 0) flowDepth--;
    else if (ch === ":" && flowDepth === 0) {
      if (i === text.length - 1 || /\s/.test(text[i + 1])) {
        return {
          keyRaw: text.slice(0, i).trim(),
          rest: text.slice(i + 1).trim(),
        };
      }
    }
  }
  return null;
}

function checkTokenSafety(trimmed, lineNum) {
  if (!trimmed) return;
  if (/^(?:\*|\&)[A-Za-z0-9_-]+/.test(trimmed)) {
    throw new YamlSecurityError("frontmatter_alias_forbidden", "YAML aliases are not allowed", lineNum);
  }
  if (/^![^\s]*/.test(trimmed)) {
    throw new YamlSecurityError(
      "frontmatter_custom_tag_forbidden",
      "Custom YAML tags are not allowed",
      lineNum,
    );
  }
}

function unquoteDouble(str, lineNum) {
  let out = "";
  for (let i = 1; i < str.length - 1; i++) {
    const ch = str[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    i++;
    if (i >= str.length - 1) {
      throw new YamlSecurityError("frontmatter_parse_error", "Unterminated escape in double-quoted string", lineNum);
    }
    const esc = str[i];
    if (esc === "n") out += "\n";
    else if (esc === "r") out += "\r";
    else if (esc === "t") out += "\t";
    else if (esc === '"') out += '"';
    else if (esc === "\\") out += "\\";
    else if (esc === "/") out += "/";
    else if (esc === "u") {
      const hex = str.slice(i + 1, i + 5);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
        throw new YamlSecurityError("frontmatter_parse_error", "Invalid \\u escape in YAML string", lineNum);
      }
      out += String.fromCharCode(Number.parseInt(hex, 16));
      i += 4;
    } else {
      out += esc;
    }
  }
  return out;
}

function parseScalar(raw, lineNum) {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  checkTokenSafety(trimmed, lineNum);

  if (trimmed.startsWith('"')) {
    if (!trimmed.endsWith('"') || trimmed.length < 2) {
      throw new YamlSecurityError("frontmatter_parse_error", "Unterminated double-quoted string", lineNum);
    }
    return unquoteDouble(trimmed, lineNum);
  }
  if (trimmed.startsWith("'")) {
    if (!trimmed.endsWith("'") || trimmed.length < 2) {
      throw new YamlSecurityError("frontmatter_parse_error", "Unterminated single-quoted string", lineNum);
    }
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }

  if (trimmed === "null" || trimmed === "~") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) {
    const num = Number(trimmed);
    if (Number.isFinite(num)) return num;
  }

  // Reject unquoted inline flow starts that fell through to scalar parsing.
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    return parseFlowValue(trimmed, lineNum, 0);
  }

  return trimmed;
}

function parseFlowValue(input, lineNum, depth) {
  if (depth > FRONTMATTER_MAX_DEPTH) {
    throw new YamlSecurityError(
      "frontmatter_limit_depth",
      `Frontmatter nesting exceeds ${FRONTMATTER_MAX_DEPTH}`,
      lineNum,
    );
  }
  let pos = 0;

  function skipWs() {
    while (pos < input.length && /\s/.test(input[pos])) pos++;
  }

  function readValue(curDepth) {
    if (curDepth > FRONTMATTER_MAX_DEPTH) {
      throw new YamlSecurityError(
        "frontmatter_limit_depth",
        `Frontmatter nesting exceeds ${FRONTMATTER_MAX_DEPTH}`,
        lineNum,
      );
    }
    skipWs();
    if (pos >= input.length) {
      throw new YamlSecurityError("frontmatter_parse_error", "Unexpected end of flow YAML value", lineNum);
    }
    const ch = input[pos];
    if (ch === "[") return readArray(curDepth + 1);
    if (ch === "{") return readObject(curDepth + 1);
    if (ch === '"' || ch === "'") return readQuoted();

    const start = pos;
    while (pos < input.length && !/[,\]\}:]/.test(input[pos])) {
      pos++;
    }
    const token = input.slice(start, pos).trim();
    return parseScalar(token, lineNum);
  }

  function readQuoted() {
    const quote = input[pos];
    const start = pos;
    pos++;
    while (pos < input.length) {
      const ch = input[pos];
      if (quote === '"' && ch === "\\") {
        pos += 2;
        continue;
      }
      if (quote === "'" && ch === "'" && input[pos + 1] === "'") {
        pos += 2;
        continue;
      }
      if (ch === quote) {
        pos++;
        return parseScalar(input.slice(start, pos), lineNum);
      }
      pos++;
    }
    throw new YamlSecurityError("frontmatter_parse_error", "Unterminated quoted flow scalar", lineNum);
  }

  function readArray(curDepth) {
    if (curDepth > FRONTMATTER_MAX_DEPTH) {
      throw new YamlSecurityError(
        "frontmatter_limit_depth",
        `Frontmatter nesting exceeds ${FRONTMATTER_MAX_DEPTH}`,
        lineNum,
      );
    }
    pos++; // skip '['
    const arr = [];
    skipWs();
    if (input[pos] === "]") {
      pos++;
      return arr;
    }
    while (pos < input.length) {
      arr.push(readValue(curDepth));
      skipWs();
      if (input[pos] === ",") {
        pos++;
        skipWs();
        if (input[pos] === "]") {
          pos++;
          return arr;
        }
        continue;
      }
      if (input[pos] === "]") {
        pos++;
        return arr;
      }
      throw new YamlSecurityError("frontmatter_parse_error", "Expected ',' or ']' in flow sequence", lineNum);
    }
    throw new YamlSecurityError("frontmatter_parse_error", "Unterminated flow sequence", lineNum);
  }

  function readObject(curDepth) {
    if (curDepth > FRONTMATTER_MAX_DEPTH) {
      throw new YamlSecurityError(
        "frontmatter_limit_depth",
        `Frontmatter nesting exceeds ${FRONTMATTER_MAX_DEPTH}`,
        lineNum,
      );
    }
    pos++; // skip '{'
    const obj = {};
    const seen = new Set();
    skipWs();
    if (input[pos] === "}") {
      pos++;
      return obj;
    }
    while (pos < input.length) {
      skipWs();
      let key;
      if (input[pos] === '"' || input[pos] === "'") {
        key = String(readQuoted());
      } else {
        const start = pos;
        while (pos < input.length && input[pos] !== ":") pos++;
        key = input.slice(start, pos).trim();
        checkTokenSafety(key, lineNum);
      }
      if (!key) {
        throw new YamlSecurityError("frontmatter_parse_error", "Empty key in flow mapping", lineNum);
      }
      skipWs();
      if (input[pos] !== ":") {
        throw new YamlSecurityError("frontmatter_parse_error", "Expected ':' in flow mapping", lineNum);
      }
      pos++;
      if (seen.has(key)) {
        throw new YamlSecurityError("frontmatter_duplicate_key", `Duplicate key: ${key}`, lineNum);
      }
      seen.add(key);
      setSafeProp(obj, key, readValue(curDepth));
      skipWs();
      if (input[pos] === ",") {
        pos++;
        skipWs();
        if (input[pos] === "}") {
          pos++;
          return obj;
        }
        continue;
      }
      if (input[pos] === "}") {
        pos++;
        return obj;
      }
      throw new YamlSecurityError("frontmatter_parse_error", "Expected ',' or '}' in flow mapping", lineNum);
    }
    throw new YamlSecurityError("frontmatter_parse_error", "Unterminated flow mapping", lineNum);
  }

  const val = readValue(depth);
  skipWs();
  if (pos < input.length) {
    throw new YamlSecurityError("frontmatter_parse_error", "Unexpected trailing tokens in flow YAML value", lineNum);
  }
  return val;
}

function parseValueExpression(raw, lineNum, depth) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  checkTokenSafety(trimmed, lineNum);
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    return parseFlowValue(trimmed, lineNum, depth);
  }
  return parseScalar(trimmed, lineNum);
}

function preprocessLines(yamlText) {
  const rawLines = yamlText.split("\n");
  const lines = [];
  for (let idx = 0; idx < rawLines.length; idx++) {
    const raw = rawLines[idx];
    const lineNum = idx + 2; // opening --- is line 1
    if (/^\t/.test(raw)) {
      throw new YamlSecurityError("frontmatter_parse_error", "Tabs are not allowed for YAML indentation", lineNum);
    }
    const noComment = stripInlineComment(raw);
    const trimmed = noComment.trim();
    if (trimmed === "---" || trimmed === "...") {
      throw new YamlSecurityError(
        "frontmatter_multiple_documents",
        "Multiple YAML documents in frontmatter",
        lineNum,
      );
    }
    const indent = raw.match(/^ */)[0].length;
    lines.push({ raw, indent, trimmed, text: noComment.slice(indent), lineNum });
  }
  return lines;
}

function parseYamlSubset(yamlText) {
  const lines = preprocessLines(yamlText);

  function nextNonEmpty(i) {
    while (i < lines.length && lines[i].trimmed === "") i++;
    return i;
  }

  function readBlockScalar(startIndex, parentIndent, indicator) {
    const folded = indicator.startsWith(">");
    const chomp = indicator.endsWith("-") ? "strip" : indicator.endsWith("+") ? "keep" : "clip";
    const collected = [];
    let blockIndent = null;
    let i = startIndex;

    while (i < lines.length) {
      const line = lines[i];
      if (line.raw.trim() === "") {
        collected.push("");
        i++;
        continue;
      }
      if (blockIndent === null) {
        if (line.indent <= parentIndent) break;
        blockIndent = line.indent;
      } else if (line.indent < blockIndent) {
        break;
      }
      collected.push(line.raw.slice(blockIndent));
      i++;
    }

    while (collected.length > 0 && chomp !== "keep" && collected[collected.length - 1] === "") {
      collected.pop();
    }

    let text;
    if (folded) {
      text = collected
        .join("\n")
        .replace(/([^\n])\n([^\n])/g, "$1 $2");
    } else {
      text = collected.join("\n");
    }
    if (chomp === "clip" && text.length > 0) text += "\n";
    return { value: text, nextIndex: i };
  }

  function parseBlock(startIndex, minIndent, depth) {
    if (depth > FRONTMATTER_MAX_DEPTH) {
      throw new YamlSecurityError(
        "frontmatter_limit_depth",
        `Frontmatter nesting exceeds ${FRONTMATTER_MAX_DEPTH}`,
        lines[startIndex]?.lineNum,
      );
    }
    const i = nextNonEmpty(startIndex);
    if (i >= lines.length) return { value: {}, nextIndex: i };
    const first = lines[i];
    if (first.indent < minIndent) return { value: null, nextIndex: i };
    if (/^-(?:\s|$)/.test(first.text)) {
      return parseSequence(i, first.indent, depth);
    }
    return parseMapping(i, first.indent, depth);
  }

  function parseSequence(startIndex, expectedIndent, depth) {
    if (depth > FRONTMATTER_MAX_DEPTH) {
      throw new YamlSecurityError(
        "frontmatter_limit_depth",
        `Frontmatter nesting exceeds ${FRONTMATTER_MAX_DEPTH}`,
        lines[startIndex]?.lineNum,
      );
    }
    const arr = [];
    let i = startIndex;
    while (i < lines.length) {
      i = nextNonEmpty(i);
      if (i >= lines.length) break;
      const line = lines[i];
      if (line.indent < expectedIndent) break;
      if (line.indent > expectedIndent) {
        throw new YamlSecurityError("frontmatter_parse_error", "Unexpected indentation in YAML sequence", line.lineNum);
      }
      if (!/^-(?:\s|$)/.test(line.text)) break;

      const afterDash = line.text.slice(1).trim();
      if (!afterDash) {
        const nextIdx = nextNonEmpty(i + 1);
        if (nextIdx < lines.length && lines[nextIdx].indent > expectedIndent) {
          const nested = parseBlock(nextIdx, expectedIndent + 1, depth + 1);
          arr.push(nested.value);
          i = nested.nextIndex;
        } else {
          arr.push(null);
          i++;
        }
        continue;
      }

      if (/^[|>][+-]?$/.test(afterDash)) {
        const block = readBlockScalar(i + 1, expectedIndent, afterDash);
        arr.push(block.value);
        i = block.nextIndex;
        continue;
      }

      const mapInline = splitUnquotedFirstColon(afterDash);
      if (mapInline) {
        // Inline mapping item inside sequence: `- key: val` possibly followed by more keys at indent + 2
        const itemIndent = expectedIndent + line.text.indexOf(afterDash);
        const obj = {};
        const seen = new Set();
        const key = unquoteKey(mapInline.keyRaw, line.lineNum);
        seen.add(key);
        if (mapInline.rest === "") {
          const nextIdx = nextNonEmpty(i + 1);
          if (nextIdx < lines.length && lines[nextIdx].indent > itemIndent) {
            const nested = parseBlock(nextIdx, itemIndent + 1, depth + 2);
            setSafeProp(obj, key, nested.value);
            i = nested.nextIndex;
          } else {
            setSafeProp(obj, key, null);
            i++;
          }
        } else if (/^[|>][+-]?$/.test(mapInline.rest)) {
          const block = readBlockScalar(i + 1, itemIndent, mapInline.rest);
          setSafeProp(obj, key, block.value);
          i = block.nextIndex;
        } else {
          setSafeProp(obj, key, parseValueExpression(mapInline.rest, line.lineNum, depth + 1));
          i++;
        }
        // Parse sibling keys belonging to the same sequence object
        const sibIdx = nextNonEmpty(i);
        if (
          sibIdx < lines.length &&
          lines[sibIdx].indent === itemIndent &&
          !/^-(?:\s|$)/.test(lines[sibIdx].text)
        ) {
          const restMap = parseMapping(sibIdx, itemIndent, depth + 1, obj, seen);
          i = restMap.nextIndex;
        }
        arr.push(obj);
        continue;
      }

      arr.push(parseValueExpression(afterDash, line.lineNum, depth + 1));
      i++;
    }
    return { value: arr, nextIndex: i };
  }

  function unquoteKey(keyRaw, lineNum) {
    checkTokenSafety(keyRaw, lineNum);
    if (!keyRaw) {
      throw new YamlSecurityError("frontmatter_parse_error", "Empty mapping key in YAML", lineNum);
    }
    if (
      (keyRaw.startsWith('"') && keyRaw.endsWith('"')) ||
      (keyRaw.startsWith("'") && keyRaw.endsWith("'"))
    ) {
      return String(parseScalar(keyRaw, lineNum));
    }
    return keyRaw;
  }

  function parseMapping(
    startIndex,
    expectedIndent,
    depth,
    targetObj = {},
    seen = new Set(),
  ) {
    if (depth > FRONTMATTER_MAX_DEPTH) {
      throw new YamlSecurityError(
        "frontmatter_limit_depth",
        `Frontmatter nesting exceeds ${FRONTMATTER_MAX_DEPTH}`,
        lines[startIndex]?.lineNum,
      );
    }
    let i = startIndex;
    while (i < lines.length) {
      i = nextNonEmpty(i);
      if (i >= lines.length) break;
      const line = lines[i];
      if (line.indent < expectedIndent) break;
      if (line.indent > expectedIndent) {
        throw new YamlSecurityError(
          "frontmatter_parse_error",
          "Unexpected indentation in YAML mapping",
          line.lineNum,
        );
      }
      if (/^-(?:\s|$)/.test(line.text)) break;

      const split = splitUnquotedFirstColon(line.text);
      if (!split) {
        throw new YamlSecurityError(
          "frontmatter_parse_error",
          `Invalid YAML mapping entry: ${line.text}`,
          line.lineNum,
        );
      }
      const key = unquoteKey(split.keyRaw, line.lineNum);
      if (seen.has(key)) {
        throw new YamlSecurityError("frontmatter_duplicate_key", `Duplicate key: ${key}`, line.lineNum);
      }
      seen.add(key);

      if (/^[|>][+-]?$/.test(split.rest)) {
        const block = readBlockScalar(i + 1, expectedIndent, split.rest);
        setSafeProp(targetObj, key, block.value);
        i = block.nextIndex;
        continue;
      }

      if (split.rest === "") {
        const nextIdx = nextNonEmpty(i + 1);
        if (nextIdx < lines.length) {
          const nextLine = lines[nextIdx];
          if (
            nextLine.indent > expectedIndent ||
            (nextLine.indent === expectedIndent && /^-(?:\s|$)/.test(nextLine.text))
          ) {
            const nested = parseBlock(nextIdx, nextLine.indent, depth + 1);
            setSafeProp(targetObj, key, nested.value);
            i = nested.nextIndex;
            continue;
          }
        }
        setSafeProp(targetObj, key, null);
        i++;
        continue;
      }

      setSafeProp(targetObj, key, parseValueExpression(split.rest, line.lineNum, depth + 1));
      i++;
    }
    return { value: targetObj, nextIndex: i };
  }

  const firstIdx = nextNonEmpty(0);
  if (firstIdx >= lines.length) {
    throw new YamlSecurityError("frontmatter_parse_error", "Frontmatter must be a YAML mapping", 2);
  }
  if (/^-(?:\s|$)/.test(lines[firstIdx].text)) {
    throw new YamlSecurityError("frontmatter_parse_error", "Frontmatter must be a YAML mapping", lines[firstIdx].lineNum);
  }
  const result = parseMapping(firstIdx, lines[firstIdx].indent, 1);
  const trailing = nextNonEmpty(result.nextIndex);
  if (trailing < lines.length) {
    throw new YamlSecurityError(
      "frontmatter_parse_error",
      `Unexpected trailing YAML content at line ${lines[trailing].lineNum}`,
      lines[trailing].lineNum,
    );
  }
  return result.value;
}

function measureDepth(value, current = 0) {
  if (Array.isArray(value)) {
    let deepest = current + 1;
    for (const item of value) {
      deepest = Math.max(deepest, measureDepth(item, current + 1));
    }
    return deepest;
  }
  if (value && typeof value === "object") {
    let deepest = current + 1;
    for (const v of Object.values(value)) {
      deepest = Math.max(deepest, measureDepth(v, current + 1));
    }
    return deepest;
  }
  return current;
}

function classifySources(raw) {
  if (raw === undefined) return { kind: "absent" };
  if (raw === null) return { kind: "unknown-shape", value: null };
  if (typeof raw === "string") return { kind: "legacy-scalar", value: raw };
  if (Array.isArray(raw)) {
    if (raw.every((v) => typeof v === "string")) {
      return { kind: "legacy-list", value: raw };
    }
    if (raw.every((v) => v && typeof v === "object" && !Array.isArray(v))) {
      return { kind: "canonical", value: raw };
    }
  }
  return { kind: "unknown-shape", value: raw };
}

function parseFrontmatterBlock(content, filePath, requireType) {
  const normalized = String(content ?? "").replace(/\r\n?/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return {
      ok: false,
      diagnostics: [diag("error", "frontmatter_missing", filePath, "Missing frontmatter opening delimiter")],
    };
  }

  let closingIndex = -1;
  let i = 4;
  const candidates = [];
  let lastLineWasExplicitEnd = false;
  while (i <= normalized.length) {
    const newlinePos = normalized.indexOf("\n", i);
    const lineEnd = newlinePos === -1 ? normalized.length : newlinePos;
    const line = normalized.slice(i, lineEnd);
    if (line === "---") {
      candidates.push({ index: i, followsExplicitEnd: lastLineWasExplicitEnd });
      lastLineWasExplicitEnd = false;
    } else if (line === "...") {
      lastLineWasExplicitEnd = true;
    } else {
      lastLineWasExplicitEnd = false;
    }
    if (newlinePos === -1) break;
    i = newlinePos + 1;
  }

  if (candidates.length === 1) {
    closingIndex = candidates[0].index;
  } else if (candidates.length > 1) {
    if (candidates[0].followsExplicitEnd) {
      closingIndex = candidates[1].index;
    } else {
      closingIndex = candidates[0].index;
    }
  }

  if (closingIndex === -1) {
    return {
      ok: false,
      diagnostics: [diag("error", "frontmatter_parse_error", filePath, "Missing frontmatter closing delimiter")],
    };
  }

  const yamlText = normalized.slice(4, closingIndex);
  if (Buffer.byteLength(yamlText, "utf8") > FRONTMATTER_MAX_BYTES) {
    return {
      ok: false,
      diagnostics: [
        diag(
          "error",
          "frontmatter_limit_bytes",
          filePath,
          `Frontmatter exceeds ${FRONTMATTER_MAX_BYTES} bytes`,
        ),
      ],
    };
  }

  let mapping;
  try {
    mapping = parseYamlSubset(yamlText);
  } catch (err) {
    const code = err instanceof YamlSecurityError ? err.code : "frontmatter_parse_error";
    return {
      ok: false,
      diagnostics: [diag("error", code, filePath, `YAML parse error: ${err.message}`, err.line)],
    };
  }

  if (measureDepth(mapping, 0) > FRONTMATTER_MAX_DEPTH) {
    return {
      ok: false,
      diagnostics: [
        diag(
          "error",
          "frontmatter_limit_depth",
          filePath,
          `Frontmatter nesting exceeds ${FRONTMATTER_MAX_DEPTH}`,
        ),
      ],
    };
  }

  // Advance past closing `---` (plus optional single `\n`)
  const afterClosing = normalized.slice(closingIndex + 3);
  let body = afterClosing.startsWith("\n") ? afterClosing.slice(1) : afterClosing;
  if (body.startsWith("\n")) body = body.slice(1);

  if (!requireType) {
    return { ok: true, mapping, body, diagnostics: [] };
  }

  const rawType = mapping.type;
  if (typeof rawType !== "string" || rawType.trim() === "") {
    return {
      ok: false,
      diagnostics: [diag("error", "concept_missing_type", filePath, "Missing or empty type field")],
    };
  }

  const sources = classifySources(mapping.sources);
  const frontmatter = { type: rawType };
  const extensions = {};
  const legacyFields = [];

  for (const [key, value] of Object.entries(mapping)) {
    if (key === "sources") continue;
    if (STANDARD_FIELD_SET.has(key)) {
      setSafeProp(frontmatter, key, value);
      if (LEGACY_COMPAT_FIELDS.has(key)) legacyFields.push(key);
    } else {
      setSafeProp(extensions, key, value);
    }
  }

  if (sources.kind === "legacy-scalar" || sources.kind === "legacy-list") {
    legacyFields.push("sources");
  }
  const hasLegacyWikilinks = /\[\[[^\]]+\]\]/.test(body);
  if (hasLegacyWikilinks) legacyFields.push("wikilinks");

  return {
    ok: true,
    document: {
      id: filePath.replace(/\.md$/, ""),
      path: filePath,
      frontmatter,
      sources,
      extensions,
      body,
      compatibility: { legacyFields, hasLegacyWikilinks },
    },
    diagnostics: [],
  };
}

export function parseMarkdownFrontmatter(content, filePath) {
  return parseFrontmatterBlock(content, filePath, false);
}

export function parseKnowledgeDocument(content, filePath) {
  return parseFrontmatterBlock(content, filePath, true);
}

function formatYamlScalar(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  const s = String(value);
  if (s === "") return '""';
  const needsQuote =
    /^\s|\s$/.test(s) ||
    /^(?:true|false|null|~|-?\d+(?:\.\d+)?)$/i.test(s) ||
    /[:#\[\]{}&*!|>'"%@`\n\r\t\\]/.test(s) ||
    s.startsWith("- ") ||
    s.startsWith("? ");
  return needsQuote ? JSON.stringify(s) : s;
}

function serializeYamlMapping(obj, indent = 0) {
  const pad = " ".repeat(indent);
  const lines = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    const keyText = /^[A-Za-z0-9_.-]+$/.test(key) ? key : JSON.stringify(key);
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${pad}${keyText}: []`);
      } else {
        lines.push(`${pad}${keyText}:`);
        for (const item of value) {
          if (item && typeof item === "object" && !Array.isArray(item)) {
            const entries = Object.entries(item);
            if (entries.length === 0) {
              lines.push(`${pad}  - {}`);
            } else {
              const [firstK, firstV] = entries[0];
              const fkText = /^[A-Za-z0-9_.-]+$/.test(firstK) ? firstK : JSON.stringify(firstK);
              if (firstV && typeof firstV === "object") {
                lines.push(`${pad}  - ${fkText}:`);
                lines.push(serializeYamlValue(firstV, indent + 6));
              } else {
                lines.push(`${pad}  - ${fkText}: ${formatYamlScalar(firstV)}`);
              }
              for (const [k2, v2] of entries.slice(1)) {
                const k2Text = /^[A-Za-z0-9_.-]+$/.test(k2) ? k2 : JSON.stringify(k2);
                if (v2 && typeof v2 === "object") {
                  lines.push(`${pad}    ${k2Text}:`);
                  lines.push(serializeYamlValue(v2, indent + 6));
                } else {
                  lines.push(`${pad}    ${k2Text}: ${formatYamlScalar(v2)}`);
                }
              }
            }
          } else if (Array.isArray(item)) {
            lines.push(`${pad}  - ${JSON.stringify(item)}`);
          } else {
            lines.push(`${pad}  - ${formatYamlScalar(item)}`);
          }
        }
      }
    } else if (value && typeof value === "object") {
      const entries = Object.entries(value);
      if (entries.length === 0) {
        lines.push(`${pad}${keyText}: {}`);
      } else {
        lines.push(`${pad}${keyText}:`);
        lines.push(serializeYamlMapping(value, indent + 2));
      }
    } else {
      lines.push(`${pad}${keyText}: ${formatYamlScalar(value)}`);
    }
  }
  return lines.join("\n");
}

function serializeYamlValue(value, indent) {
  if (Array.isArray(value)) {
    const pad = " ".repeat(indent);
    if (value.length === 0) return `${pad}[]`;
    return value
      .map((item) =>
        item && typeof item === "object"
          ? `${pad}-\n${serializeYamlValue(item, indent + 2)}`
          : `${pad}- ${formatYamlScalar(item)}`,
      )
      .join("\n");
  }
  return serializeYamlMapping(value, indent);
}

export function serializeKnowledgeDocument(document) {
  const mapping = Object.create(null);
  for (const key of STANDARD_FIELDS) {
    if (key === "sources") continue;
    const val = document.frontmatter[key];
    if (val !== undefined) mapping[key] = val;
  }
  if (document.sources && document.sources.kind !== "absent") {
    mapping.sources = document.sources.value;
  }
  for (const [key, val] of Object.entries(document.extensions ?? {})) {
    mapping[key] = val;
  }
  const yaml = serializeYamlMapping(mapping);
  const body = String(document.body ?? "").replace(/\r\n?/g, "\n").replace(/\n*$/, "");
  return body ? `---\n${yaml}\n---\n\n${body}\n` : `---\n${yaml}\n---\n`;
}

const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;

export function escapeWikilinkAliasPipes(body) {
  let inFence = false;
  return String(body ?? "")
    .split("\n")
    .map((line) => {
      if (/^\s*(`{3,}|~{3,})/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      return TABLE_ROW_RE.test(line)
        ? line.replace(/\[\[([^\]\n]*?)(?<!\\)\|([^\]\n]*?)\]\]/g, "[[$1\\|$2]]")
        : line;
    })
    .join("\n");
}

export function createKnowledgeDocument(relPath, fields, body, canonicalSources) {
  if (Object.hasOwn(fields, "sources")) {
    throw new Error("Pass canonical sources as the fourth argument");
  }
  const frontmatter = { type: fields.type };
  const extensions = {};
  for (const [key, val] of Object.entries(fields)) {
    if (key === "type") continue;
    if (STANDARD_FIELD_SET.has(key)) setSafeProp(frontmatter, key, val);
    else setSafeProp(extensions, key, val);
  }
  const sources = canonicalSources
    ? { kind: "canonical", value: canonicalSources }
    : { kind: "absent" };
  const normalizedBody = escapeWikilinkAliasPipes(
    String(body ?? "").replace(/\r\n?/g, "\n"),
  ).replace(/\n*$/, "");

  return {
    id: relPath.replace(/\.md$/, ""),
    path: relPath,
    frontmatter,
    sources,
    extensions,
    body: normalizedBody,
    compatibility: {
      legacyFields: [],
      hasLegacyWikilinks: /\[\[[^\]]+\]\]/.test(normalizedBody),
    },
  };
}

export function readKnowledgeDocumentFile(filePath, id) {
  const content = readFileSync(filePath, "utf8");
  return parseKnowledgeDocument(content, id);
}

export function writeKnowledgeDocumentFile(filePath, document) {
  writeFileSync(filePath, serializeKnowledgeDocument(document), "utf8");
}
