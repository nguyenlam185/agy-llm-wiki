import { compareCodePoint, slugify } from "./paths.mjs";

function diag(severity, code, path, message) {
  return { severity, code, path, message };
}

function normalizeWikilinkTarget(target) {
  return String(target ?? "").trim().replace(/\\$/, "");
}

function maskRange(chars, start, end) {
  for (let i = start; i < end && i < chars.length; i++) {
    if (chars[i] !== "\n") chars[i] = " ";
  }
}

/**
 * Blank out fenced code blocks, raw `<pre>`/`<code>` HTML blocks, and inline
 * backtick code spans while preserving character offsets and newlines.
 */
export function maskCodeRegions(body) {
  const input = String(body ?? "");
  const chars = input.split("");

  // 1. Fenced code blocks (``` or ~~~)
  let lineStart = 0;
  let activeFence = null;
  while (lineStart < input.length) {
    const nl = input.indexOf("\n", lineStart);
    const lineEnd = nl === -1 ? input.length : nl;
    const line = input.slice(lineStart, lineEnd);

    if (!activeFence) {
      const open = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
      if (open) {
        const marker = open[1];
        const rest = line.slice(open[0].length);
        // CommonMark: backtick fences cannot contain backticks in the info string.
        if (!(marker[0] === "`" && rest.includes("`"))) {
          activeFence = { char: marker[0], len: marker.length };
          maskRange(chars, lineStart, lineEnd);
        }
      }
    } else {
      maskRange(chars, lineStart, lineEnd);
      const close = new RegExp(`^\\s{0,3}${activeFence.char}{${activeFence.len},}\\s*$`);
      if (close.test(line)) {
        activeFence = null;
      }
    }
    lineStart = nl === -1 ? input.length : nl + 1;
  }

  // 2. HTML <pre> and <code> blocks on unmasked text
  let passText = chars.join("");
  for (const match of passText.matchAll(/<(pre|code)\b[^>]*>[\s\S]*?<\/\1>/gi)) {
    const start = match.index ?? 0;
    maskRange(chars, start, start + match[0].length);
  }

  // 3. Inline code spans (exact backtick run matching)
  passText = chars.join("");
  let i = 0;
  while (i < passText.length) {
    if (passText[i] !== "`") {
      i++;
      continue;
    }
    let openLen = 0;
    while (i + openLen < passText.length && passText[i + openLen] === "`") openLen++;
    let j = i + openLen;
    let foundClose = -1;
    while (j < passText.length) {
      if (passText[j] === "`") {
        let closeLen = 0;
        while (j + closeLen < passText.length && passText[j + closeLen] === "`") closeLen++;
        if (closeLen === openLen) {
          foundClose = j + closeLen;
          break;
        }
        j += closeLen;
        continue;
      }
      j++;
    }
    if (foundClose !== -1) {
      maskRange(chars, i, foundClose);
      i = foundClose;
    } else {
      i += openLen;
    }
  }

  return chars.join("");
}

/** Extract `[[wikilinks]]` and Markdown `[label](target)` links outside code regions. */
export function extractKnowledgeLinks(body) {
  const markdown = [];
  const wikilinks = [];
  const scanBody = maskCodeRegions(body);

  // 1. Wikilinks (including table-escaped `[[target\|alias]]`)
  for (const match of scanBody.matchAll(/\[\[([^\]|\n]+)(?:\|[^\]]*)?\]\]/g)) {
    wikilinks.push({
      target: normalizeWikilinkTarget(match[1]),
      offset: match.index ?? 0,
    });
  }

  // 2. Reference link definitions `[id]: url`
  const defs = new Map();
  let cursor = 0;
  for (const line of scanBody.split("\n")) {
    const defMatch = /^\s{0,3}\[([^\]\n]+)\]:\s*(<[^>\n]+>|[^\s]+)(?:\s+["'(][^\n]*["')])?\s*$/.exec(
      line,
    );
    if (defMatch) {
      const ident = defMatch[1].trim().toLowerCase();
      let url = defMatch[2].trim();
      if (url.startsWith("<") && url.endsWith(">")) url = url.slice(1, -1);
      if (!defs.has(ident)) defs.set(ident, url);
    }
    cursor += line.length + 1;
  }

  // 3. Inline Markdown links `[label](target)` (not preceded by `!`, not inside `[[...]]`)
  const inlineRanges = [];
  const inlineRe =
    /(?<!!)(?<!\[)\[(?:[^\[\]\n]|\\.)*\]\((<[^>\n]+>|[^()\s\n]+(?:\([^()\n]*\)[^()\s\n]*)*)(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\)/g;
  for (const match of scanBody.matchAll(inlineRe)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    inlineRanges.push([start, end]);
    let target = match[1].trim();
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
    if (target) {
      markdown.push({ target, offset: start });
    }
  }

  // 4. Reference links `[text][id]` / `[id][]` / `[id]`
  if (defs.size > 0) {
    const usedDefs = new Set();
    const refRe = /(?<!!)(?<!\[)\[((?:[^\[\]\n]|\\.)+)\](?:\[([^\[\]\n]*)\])?(?!\()/g;
    for (const match of scanBody.matchAll(refRe)) {
      const start = match.index ?? 0;
      const inInline = inlineRanges.some(([s, e]) => start >= s && start < e);
      if (inInline) continue;
      // Ignore definition lines `[id]: ...`
      const afterEnd = scanBody.slice(start + match[0].length);
      if (afterEnd.startsWith(":")) continue;

      const ident = (match[2] ? match[2] : match[1]).trim().toLowerCase();
      if (defs.has(ident) && !usedDefs.has(ident)) {
        usedDefs.add(ident);
        markdown.push({ target: defs.get(ident), offset: start });
      }
    }
  }

  return { markdown, wikilinks };
}

export function buildWikilinkIndex(ids) {
  const byExact = new Map();
  const byNormPath = new Map();
  const byNormSlug = new Map();

  function push(map, key, value) {
    const existing = map.get(key);
    if (existing) existing.push(value);
    else map.set(key, [value]);
  }

  for (const id of ids) {
    byExact.set(id.normalize("NFC"), id);
    const segments = id.split("/");
    const normFull = segments.map((s) => slugify(s)).join("/");
    const normBase = slugify(segments[segments.length - 1]);
    push(byNormPath, normFull, id);
    push(byNormSlug, normBase, id);
  }

  return { byExact, byNormPath, byNormSlug };
}

export function resolveWikilink(target, index) {
  const cleaned = normalizeWikilinkTarget(target);
  if (!cleaned) return { kind: "missing", target: "" };

  const exact = index.byExact.get(cleaned.normalize("NFC"));
  if (exact) return { kind: "resolved", id: exact };

  const normFull = cleaned
    .split("/")
    .map((s) => slugify(s))
    .join("/");
  const pathHits = index.byNormPath.get(normFull);
  if (pathHits && pathHits.length === 1) return { kind: "resolved", id: pathHits[0] };
  if (pathHits && pathHits.length > 1) {
    return { kind: "ambiguous", target: cleaned, candidates: pathHits };
  }

  if (!cleaned.includes("/")) {
    const baseHits = index.byNormSlug.get(slugify(cleaned));
    if (baseHits && baseHits.length === 1) return { kind: "resolved", id: baseHits[0] };
    if (baseHits && baseHits.length > 1) {
      return { kind: "ambiguous", target: cleaned, candidates: baseHits };
    }
  }

  return { kind: "missing", target: cleaned };
}

export function resolveMarkdownTarget(target, sourceId) {
  const qIndex = target.indexOf("?");
  const fIndex = target.indexOf("#");
  let clean = target;
  let cut = -1;
  if (qIndex !== -1 && (fIndex === -1 || qIndex < fIndex)) cut = qIndex;
  else if (fIndex !== -1) cut = fIndex;
  if (cut !== -1) clean = target.slice(0, cut);

  if (!clean || clean === "#") return { kind: "empty" };
  if (/^[a-z][a-z0-9+.-]*:/i.test(clean)) return { kind: "external" };

  let decoded;
  try {
    decoded = clean.split("/").map((segment) => decodeURIComponent(segment));
  } catch {
    return { kind: "invalid" };
  }

  const normalized = decoded.map((s) => s.replace(/\\/g, "/")).join("/");
  const sourceDir = sourceId.replace(/[^/]*$/, "");
  const parts = normalized.split("/");

  if (normalized.startsWith("/")) {
    const stack = [];
    for (const part of parts) {
      if (part === "" || part === ".") continue;
      if (part === "..") {
        if (stack.length === 0) return { kind: "escape" };
        stack.pop();
      } else {
        stack.push(part);
      }
    }
    const resolved = stack.join("/");
    if (!resolved.endsWith(".md")) return { kind: "empty" };
    return { kind: "concept", id: resolved.slice(0, -3) };
  }

  const allParts = sourceDir.split("/").filter(Boolean);
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (allParts.length === 0) return { kind: "escape" };
      allParts.pop();
    } else {
      allParts.push(part);
    }
  }

  const resolved = allParts.join("/");
  if (resolved.endsWith(".md")) {
    return { kind: "concept", id: resolved.slice(0, -3) };
  }
  return { kind: "empty" };
}

export function buildResolvedBacklinks(sourceId, body, index) {
  const diagnostics = [];
  const unresolved = [];
  const targets = new Set();
  const allLinks = extractKnowledgeLinks(body);

  for (const link of allLinks.markdown) {
    const resolved = resolveMarkdownTarget(link.target, sourceId);
    if (resolved.kind === "escape") {
      diagnostics.push(
        diag("warning", "link_path_escape", `${sourceId}.md`, `Link escapes bundle root: ${link.target}`),
      );
    } else if (resolved.kind === "invalid") {
      diagnostics.push(
        diag(
          "warning",
          "link_unresolved",
          `${sourceId}.md`,
          `Malformed percent-encoded link: ${link.target}`,
        ),
      );
    } else if (resolved.kind === "concept") {
      const canonical = index.byExact.get(resolved.id.normalize("NFC"));
      if (canonical) {
        targets.add(canonical);
      } else {
        unresolved.push({ target: resolved.id, syntax: "markdown" });
        diagnostics.push(
          diag("warning", "link_unresolved", `${sourceId}.md`, `Unresolved link: ${resolved.id}`),
        );
      }
    }
  }

  for (const link of allLinks.wikilinks) {
    const res = resolveWikilink(link.target, index);
    if (res.kind === "resolved") {
      targets.add(res.id);
    } else if (res.kind === "ambiguous") {
      diagnostics.push(
        diag(
          "warning",
          "link_ambiguous",
          `${sourceId}.md`,
          `Ambiguous wikilink: ${res.target} (candidates: ${res.candidates.join(", ")})`,
        ),
      );
    } else {
      unresolved.push({ target: res.target, syntax: "wikilink" });
      diagnostics.push(
        diag("warning", "link_unresolved", `${sourceId}.md`, `Unresolved wikilink: ${res.target}`),
      );
    }
  }

  return {
    targets: [...targets].sort(compareCodePoint),
    unresolved,
    diagnostics,
  };
}

const WIKILINK_REPLACE_RE = /\[\[([^\]|\n]+)(\|[^\]]*)?\]\]/g;

export function auditWikilinks(body, index, sourceId, mode) {
  if (mode === "off") return { diagnostics: [], body, changed: false };
  const diagnostics = [];
  for (const { target } of extractKnowledgeLinks(body).wikilinks) {
    const resolved = resolveWikilink(target, index);
    if (resolved.kind === "ambiguous") {
      diagnostics.push(
        diag(
          "warning",
          "link_ambiguous",
          sourceId,
          `Wikilink target "${target}" matches multiple pages (${resolved.candidates.join(", ")}).`,
        ),
      );
    } else if (resolved.kind === "missing") {
      diagnostics.push(
        diag(
          "warning",
          "link_unresolved",
          sourceId,
          `Wikilink target "${target}" does not match any page.`,
        ),
      );
    }
  }

  let out = body;
  if (mode === "normalize") {
    out = body.replace(WIKILINK_REPLACE_RE, (full, raw, alias) => {
      const resolved = resolveWikilink(normalizeWikilinkTarget(raw), index);
      return resolved.kind === "resolved" ? `[[${resolved.id}${alias ?? ""}]]` : full;
    });
  }

  return { diagnostics, body: out, changed: out !== body };
}

export function applyWikilinkGate(body, index, sourceId, mode = "warn") {
  if (mode === "off") return { ok: true, body, diagnostics: [] };
  const audit = auditWikilinks(body, index, sourceId, mode);
  return {
    ok: !(mode === "strict" && audit.diagnostics.length > 0),
    body: mode === "normalize" ? audit.body : body,
    diagnostics: audit.diagnostics,
  };
}
