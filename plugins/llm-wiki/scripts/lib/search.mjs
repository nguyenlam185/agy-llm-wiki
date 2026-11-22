import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseKnowledgeDocument } from "./frontmatter.mjs";
import { readJson } from "./paths.mjs";
import { inspectWritableVault, readVaultConfig } from "./vault.mjs";

export const DEFAULT_RECALL_LINKS_THRESHOLD = 50;
const LINKS_SNIPPET_MAX = 80;

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

const STOPWORDS = new Set([
  "the", "this", "that", "with", "from", "have", "been", "were", "they", "their",
  "them", "will", "would", "could", "should", "about", "there", "which", "what",
  "when", "where", "than", "then", "also", "just", "more", "some", "such", "only",
  "other", "into", "over", "very", "after", "before", "because", "between",
  "through", "during", "without", "within", "along", "these", "those", "page",
  "section", "note", "info", "type", "used", "using", "to", "so", "did", "do",
  "does", "and", "or", "but", "a", "an", "i", "it", "its", "is", "are", "was",
  "be", "am", "for", "on", "at", "by", "as", "if", "in", "of", "up", "out",
  "not", "no", "can", "has", "had", "me", "my", "you", "your", "we", "our", "us",
  "too",
]);

function flattenSearchValue(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(flattenSearchValue).join(" ");
  if (typeof value === "object") return Object.values(value).map(flattenSearchValue).join(" ");
  return String(value);
}

function normalizeText(value) {
  return flattenSearchValue(value)
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[-_./\\]+/g, " ")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactText(value) {
  return value.replace(/\s+/g, "");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function queryTerms(query) {
  const normalized = normalizeText(query);
  const compact = compactText(normalized);
  const terms = [];

  if (normalized) terms.push(normalized);
  if (compact && compact !== normalized) terms.push(compact);

  for (const part of normalized.split(/\s+/)) {
    if (part.length >= 2 && !STOPWORDS.has(part)) terms.push(part);
  }

  for (const run of normalized.match(/[a-z0-9]{2,}/g) ?? []) {
    if (!STOPWORDS.has(run)) terms.push(run);
  }

  const cjkRuns =
    normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu) ?? [];
  for (const run of cjkRuns) {
    for (let size = 2; size <= 3; size++) {
      if (run.length < size) continue;
      for (let i = 0; i <= run.length - size; i++) {
        terms.push(run.slice(i, i + size));
      }
    }
  }

  return unique(terms).slice(0, 30);
}

/** Whole-word match for Latin/ASCII terms; compact substring for CJK runs. */
function includesTerm(haystack, term) {
  if (!haystack || !term) return false;
  const termCompact = compactText(term);
  if (CJK_RE.test(termCompact)) {
    return compactText(haystack).includes(termCompact);
  }
  if (!/\s/.test(haystack)) {
    return compactText(haystack) === termCompact;
  }
  return haystack.split(/\s+/).some((tok) => tok === term || tok === termCompact);
}

function scoreField(value, terms, weight) {
  const text = normalizeText(value);
  if (!text) return 0;
  let score = 0;
  for (const term of terms) {
    if (includesTerm(text, term)) score += weight;
  }
  return score;
}

function chunkPage(body) {
  if (!body.trim()) return [];
  const chunks = [];
  let currentHeading = "";
  let currentContent = [];

  for (const line of body.split("\n")) {
    const m = line.trim().match(/^(#{1,6})\s+(.+)$/);
    if (m) {
      if (currentContent.length > 0 || currentHeading) {
        chunks.push({ heading: currentHeading, content: currentContent.join("\n").trim() });
      }
      currentHeading = m[2].trim();
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }
  if (currentContent.length > 0 || currentHeading) {
    chunks.push({ heading: currentHeading, content: currentContent.join("\n").trim() });
  }
  return chunks;
}

function parsePage(filePath, id) {
  if (!existsSync(filePath)) return undefined;
  const res = parseKnowledgeDocument(readFileSync(filePath, "utf8"), `${id}.md`);
  if (!res.ok) return undefined;
  return { frontmatter: res.document.frontmatter, body: res.document.body };
}

function pagePreview(content) {
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "");
  return body.trim().slice(0, 200).replace(/\n/g, " ");
}

function chunkPreview(heading, content) {
  const trimmed = content.slice(0, 180).replace(/\n/g, " ");
  return heading ? `#${heading} — ${trimmed}` : trimmed;
}

function linkSnippet(preview) {
  const oneLine = String(preview ?? "").replace(/\s+/g, " ").trim();
  if (!oneLine) return "";
  return oneLine.length > LINKS_SNIPPET_MAX ? `${oneLine.slice(0, LINKS_SNIPPET_MAX)}…` : oneLine;
}

function extractExpansionTerms(scored, originalQuery, maxTerms = 6) {
  const top = scored.slice(0, Math.min(3, scored.length));
  if (top.length === 0) return [];
  const originalNorm = normalizeText(originalQuery);
  const termFreq = new Map();

  for (const { id, pagePath, entry } of top) {
    const metaText = normalizeText(
      [entry.title, entry.aliases, entry.tags, entry.summary, entry.description]
        .filter(Boolean)
        .join(" "),
    );
    for (const w of metaText.split(/\s+/)) {
      if (w.length >= 4 && !originalNorm.includes(w) && !STOPWORDS.has(w)) {
        termFreq.set(w, (termFreq.get(w) || 0) + 1);
      }
    }
    const parsed = parsePage(pagePath, id);
    if (parsed) {
      for (const w of normalizeText(parsed.body).split(/\s+/)) {
        if (w.length >= 4 && !originalNorm.includes(w) && !STOPWORDS.has(w)) {
          termFreq.set(w, (termFreq.get(w) || 0) + 1);
        }
      }
    }
  }

  return [...termFreq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxTerms)
    .map(([t]) => t);
}

export function searchWiki(paths, { query, type, max = 5, linksOnly, inline } = {}) {
  const writable = inspectWritableVault(paths);
  if (!writable.ok) {
    return { ok: false, error: writable.diagnostics[0].message, diagnostics: writable.diagnostics };
  }

  const registry = readJson(join(paths.meta, "registry.json"), { pages: {} });
  const terms = queryTerms(query ?? "");
  const pageEntries = Object.entries(registry.pages ?? {});
  const totalRegistered = pageEntries.length;

  const cfgRes = readVaultConfig(paths);
  const threshold = Number.isFinite(cfgRes.ok && cfgRes.config.recallLinksThreshold)
    ? Math.max(0, Math.floor(cfgRes.config.recallLinksThreshold))
    : DEFAULT_RECALL_LINKS_THRESHOLD;

  const effectiveLinksOnly =
    linksOnly === true ? true : inline === true ? false : totalRegistered > threshold;

  if (terms.length === 0) {
    return { ok: true, query: query ?? "", linksOnly: effectiveLinksOnly, totalPages: totalRegistered, results: [] };
  }

  const scored = [];
  for (const [id, entry] of pageEntries) {
    if (type && String(entry?.type ?? "").toLowerCase() !== String(type).toLowerCase()) continue;

    const pagePath = join(paths.wiki, `${id}.md`);
    const pageExists = existsSync(pagePath);
    const parsed = parsePage(pagePath, id);
    if (pageExists && !parsed) continue;

    const fm = parsed?.frontmatter ?? {};
    const body = parsed?.body ?? "";
    let score = 0;

    score += scoreField(id, terms, 3);
    score += scoreField(entry.title, terms, 5);
    score += scoreField(fm.title, terms, 5);
    score += scoreField(entry.type, terms, 1);
    score += scoreField(entry.aliases, terms, 6);
    score += scoreField(fm.aliases, terms, 6);
    score += scoreField(entry.recall_triggers, terms, 7);
    score += scoreField(fm.recall_triggers, terms, 7);
    score += scoreField(entry.summary, terms, 3);
    score += scoreField(fm.summary, terms, 3);
    score += scoreField(entry.description, terms, 3);
    score += scoreField(fm.description, terms, 3);
    score += scoreField(entry.tags, terms, 2);
    score += scoreField(entry.category, terms, 2);
    score += scoreField(entry.domain, terms, 2);
    score += scoreField(fm.tags, terms, 2);
    score += scoreField(fm.category, terms, 2);
    score += scoreField(fm.domain, terms, 2);

    let bestChunkScore = 0;
    let bestChunkHeading = "";
    let bestChunkContent = "";
    if (body.trim()) {
      for (const chunk of chunkPage(body)) {
        const cs = scoreField(chunk.heading, terms, 4) + scoreField(chunk.content, terms, 1);
        if (cs > bestChunkScore) {
          bestChunkScore = cs;
          bestChunkHeading = chunk.heading;
          bestChunkContent = chunk.content;
        }
      }
    }
    score += bestChunkScore;

    if (score > 0) {
      scored.push({
        id,
        entry,
        score,
        pagePath,
        bestChunkPreview: bestChunkContent ? chunkPreview(bestChunkHeading, bestChunkContent) : "",
      });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const expansionTerms = extractExpansionTerms(scored, query, 6);
  if (expansionTerms.length > 0) {
    const expTermList = queryTerms(expansionTerms.join(" "));
    for (const item of scored.slice(0, Math.min(25, scored.length))) {
      const parsed = parsePage(item.pagePath, item.id);
      const body = parsed?.body ?? "";
      let expChunkScore = 0;
      if (body.trim()) {
        for (const chunk of chunkPage(body)) {
          const cs = scoreField(chunk.heading, expTermList, 2) + scoreField(chunk.content, expTermList, 0.5);
          if (cs > expChunkScore) expChunkScore = cs;
        }
      }
      item.score += expChunkScore * 0.4;
    }
  }

  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const limit = Math.max(1, Math.min(Number(max) || 5, 50));
  const top = scored.slice(0, limit);

  const results = top.map(({ id, entry, pagePath, score, bestChunkPreview }) => {
    let fullPreview = bestChunkPreview;
    if (!fullPreview && existsSync(pagePath)) {
      fullPreview = pagePreview(readFileSync(pagePath, "utf8"));
    }
    const base = {
      id,
      title: String(entry.title || id),
      type: String(entry.type || "page"),
      path: pagePath,
      score: Math.round(score * 100) / 100,
    };
    if (effectiveLinksOnly) {
      return { ...base, snippet: linkSnippet(fullPreview) };
    }
    return { ...base, preview: fullPreview };
  });

  return {
    ok: true,
    query: query ?? "",
    linksOnly: effectiveLinksOnly,
    totalPages: totalRegistered,
    results,
  };
}
