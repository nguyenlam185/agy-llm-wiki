import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { buildResolvedBacklinks, buildWikilinkIndex } from "./links.mjs";
import { compareCodePoint, isPathWithin, readJson } from "./paths.mjs";
import { discoverKnowledgeDocuments, inspectVaultFormat, inspectWritableVault } from "./vault.mjs";

function okfDiag(severity, code, path, message) {
  return { severity, code, path, message };
}

export function atomicWriteFile(filePath, content) {
  mkdirSync(dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(temp, content, "utf8");
  renameSync(temp, filePath);
}

function getSemanticTitle(doc) {
  if (typeof doc.frontmatter.title === "string" && doc.frontmatter.title.trim()) {
    return doc.frontmatter.title.trim();
  }
  return doc.id.split("/").pop() || "Untitled";
}

function addRawSourceFallbacks(paths, pages) {
  if (!existsSync(paths.rawSources)) return;
  for (const entry of readdirSync(paths.rawSources)) {
    const manifestPath = join(paths.rawSources, entry, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = readJson(manifestPath, {});
    const id = String(manifest.id || entry);
    const pageKey = `sources/${id}`;
    if (pages[pageKey]) continue;

    const captured = String(manifest.captured || "");
    pages[pageKey] = {
      type: "source",
      title: String(manifest.title || id),
      ...(captured ? { created: captured, updated: captured } : {}),
      ...manifest,
    };
  }
}

function buildRegistry(paths, documents) {
  const pages = {};
  for (const doc of documents) {
    const entry = {
      type: doc.frontmatter.type,
      title: getSemanticTitle(doc),
    };
    for (const key of [
      "description",
      "tags",
      "category",
      "domain",
      "aliases",
      "recall_triggers",
      "status",
      "stale_after",
      "resource",
      "generated",
      "verified",
      "summary",
      "raw_path",
      "source_id",
    ]) {
      if (doc.frontmatter[key] !== undefined) entry[key] = doc.frontmatter[key];
    }
    for (const [key, value] of Object.entries(doc.extensions)) {
      if (!(key in entry)) entry[key] = value;
    }
    if (typeof doc.frontmatter.created === "string" && doc.frontmatter.created.trim()) {
      entry.created = doc.frontmatter.created;
    }
    if (typeof doc.frontmatter.updated === "string" && doc.frontmatter.updated.trim()) {
      entry.updated = doc.frontmatter.updated;
    }
    pages[doc.id] = entry;
  }

  addRawSourceFallbacks(paths, pages);
  return {
    version: "1.0",
    last_updated: new Date().toISOString(),
    pages,
  };
}

function buildBacklinks(documents, wikilinkIndex, diagnostics) {
  const inbound = {};
  for (const doc of documents) inbound[doc.id] = [];

  for (const doc of documents) {
    const result = buildResolvedBacklinks(doc.id, doc.body, wikilinkIndex);
    diagnostics.push(...result.diagnostics);
    for (const target of result.targets) {
      if (inbound[target] && !inbound[target].includes(doc.id)) {
        inbound[target].push(doc.id);
      }
    }
  }

  for (const [id, targets] of Object.entries(inbound)) {
    inbound[id] = [...targets].sort(compareCodePoint);
  }
  return inbound;
}

function buildIndexMarkdown(registry) {
  const byType = {};
  for (const [id, entry] of Object.entries(registry.pages)) {
    const t = entry.type || "other";
    if (!byType[t]) byType[t] = [];
    byType[t].push({ id, entry });
  }

  const sections = [
    "# Wiki Index\n\n> Auto-generated from meta/registry.json. Do not edit manually.\n",
  ];
  for (const [type, items] of Object.entries(byType).sort(([a], [b]) => compareCodePoint(a, b))) {
    const label = `${type.charAt(0).toUpperCase() + type.slice(1)}s`;
    sections.push(`## ${label}\n`);
    for (const { id, entry } of items.sort((a, b) => compareCodePoint(a.id, b.id))) {
      sections.push(`- [[${id}]] — ${entry.title} *(created: ${entry.created || "unknown"})*`);
    }
    sections.push("");
  }
  sections.push(
    `---\n*Last updated: ${registry.last_updated}* | *Total pages: ${Object.keys(registry.pages).length}*`,
  );
  return `${sections.join("\n")}\n`;
}

function buildLogMarkdown(eventsJsonl) {
  const events = [];
  for (const line of eventsJsonl.trim().split("\n")) {
    if (!line.trim()) continue;
    try {
      const candidate = JSON.parse(line);
      if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
        events.push(candidate);
      }
    } catch {
      // Omit malformed lines in rich log view.
    }
  }

  const lines = [
    "# Activity Log\n\n> Auto-generated from meta/events.jsonl. Do not edit manually.\n",
  ];
  for (const ev of events) {
    const ts = ev.timestamp || "unknown";
    const kind = ev.kind || "event";
    const details = Object.entries(ev)
      .filter(([k]) => k !== "timestamp" && k !== "kind")
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join(", ");
    lines.push(`## [${ts}] ${kind}`);
    if (details) lines.push(`- ${details}`);
    lines.push("");
  }
  if (events.length === 0) lines.push("_No events recorded yet._\n");
  return `${lines.join("\n")}\n`;
}

function canonicalJsonValue(value) {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => compareCodePoint(a, b))
        .map(([k, v]) => [k, canonicalJsonValue(v)]),
    );
  }
  return value;
}

export function buildOkfLog(eventsJsonl, diagPath = "meta/events.jsonl") {
  const diagnostics = [];
  const events = [];
  const lines = eventsJsonl.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    let parsed;
    try {
      const candidate = JSON.parse(line);
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        throw new Error("event must be a JSON object");
      }
      parsed = candidate;
    } catch {
      diagnostics.push(okfDiag("warning", "event_invalid_json", diagPath, `Invalid JSON at line ${i + 1}`));
      continue;
    }

    const rawTs = parsed.timestamp;
    if (typeof rawTs !== "string" || Number.isNaN(Date.parse(rawTs))) {
      diagnostics.push(
        okfDiag("warning", "event_invalid_timestamp", diagPath, `Invalid timestamp at line ${i + 1}`),
      );
      continue;
    }

    const rawKind = parsed.kind;
    if (typeof rawKind !== "string" || !rawKind.trim()) {
      diagnostics.push(okfDiag("warning", "event_missing_kind", diagPath, `Missing kind at line ${i + 1}`));
      continue;
    }

    const ts = new Date(rawTs);
    const date = ts.toISOString().split("T")[0];
    const kind = rawKind.trim();
    const detailEntries = Object.entries(parsed).filter(([k]) => k !== "timestamp" && k !== "kind");
    const details =
      detailEntries.length > 0
        ? JSON.stringify(canonicalJsonValue(Object.fromEntries(detailEntries)))
        : "";
    events.push({ seq: i, timestamp: rawTs, epoch: ts.getTime(), date, kind, details });
  }

  const byDate = new Map();
  for (const ev of events) {
    if (!byDate.has(ev.date)) byDate.set(ev.date, []);
    byDate.get(ev.date).push(ev);
  }

  const sortedDates = [...byDate.keys()].sort((a, b) => b.localeCompare(a));
  const outLines = ["# Wiki Update Log"];

  for (const date of sortedDates) {
    const dayEvents = byDate.get(date);
    dayEvents.sort((a, b) => b.epoch - a.epoch || b.seq - a.seq);
    outLines.push("", `## ${date}`, "");
    for (const ev of dayEvents) {
      const escapedKind = ev.kind
        .replace(/\\/g, "\\\\")
        .replace(/\*/g, "\\*")
        .replace(/_/g, "\\_")
        .replace(/\[/g, "\\[")
        .replace(/\]/g, "\\]")
        .replace(/\s+/g, " ");
      outLines.push(ev.details ? `- **${escapedKind}**: ${ev.details}` : `- **${escapedKind}**`);
    }
  }

  return { markdown: `${outLines.join("\n")}\n`, diagnostics };
}

function escapeLabel(value) {
  return value.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

function encodeRelativePath(value) {
  return value.split("/").map(encodeURIComponent).join("/");
}

function compactDescription(value) {
  if (typeof value !== "string") return undefined;
  const compact = value.replace(/\s+/g, " ").trim();
  return compact || undefined;
}

export function buildDirectoryIndexes(documents, config) {
  const indexes = new Map();
  const directories = new Map();

  for (const doc of documents) {
    const parts = doc.id.split("/");
    for (let i = 0; i < parts.length; i++) {
      const parentPath = i === 0 ? "" : parts.slice(0, i).join("/");
      if (!directories.has(parentPath)) {
        directories.set(parentPath, { dirs: new Set(), concepts: [] });
      }
      if (i === parts.length - 1) {
        directories.get(parentPath).concepts.push(doc);
      } else {
        directories.get(parentPath).dirs.add(parts[i]);
      }
    }
  }

  const vaultName =
    typeof config?.name === "string" && config.name.trim() ? config.name.trim() : "Wiki";
  if (!directories.has("")) {
    directories.set("", { dirs: new Set(), concepts: [] });
  }

  for (const [dirPath, { dirs, concepts }] of directories) {
    const indexPath = dirPath ? `${dirPath}/index.md` : "index.md";
    const lines = [];
    if (dirPath === "") {
      lines.push("---", 'okf_version: "0.2"', "---", "", `# ${escapeLabel(vaultName)}`);
    } else {
      lines.push(`# ${escapeLabel(dirPath.split("/").pop())}`);
    }

    if (dirs.size > 0) {
      lines.push("", "## Directories", "");
      for (const subDir of [...dirs].sort(compareCodePoint)) {
        lines.push(`- [${escapeLabel(subDir)}/](${encodeRelativePath(`${subDir}/index.md`)})`);
      }
    }

    if (concepts.length > 0) {
      lines.push("", "## Concepts", "");
      const sorted = [...concepts].sort((a, b) => {
        const aRel = dirPath ? a.id.slice(dirPath.length + 1) : a.id;
        const bRel = dirPath ? b.id.slice(dirPath.length + 1) : b.id;
        return compareCodePoint(aRel, bRel);
      });
      for (const doc of sorted) {
        const relId = dirPath ? doc.id.slice(dirPath.length + 1) : doc.id;
        const title =
          typeof doc.frontmatter.title === "string" && doc.frontmatter.title.trim()
            ? doc.frontmatter.title.trim()
            : relId.split("/").pop();
        const desc = compactDescription(doc.frontmatter.description);
        const descPart = desc ? ` — ${desc}` : "";
        lines.push(`- [${escapeLabel(title)}](${encodeRelativePath(`${relId}.md`)})${descPart}`);
      }
    }

    indexes.set(indexPath, `${lines.join("\n")}\n`);
  }

  return indexes;
}

function pruneObsoleteIndexes(paths, currentIndexes) {
  function walk(dir, rel) {
    const out = [];
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      let st;
      try {
        st = lstatSync(fullPath);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      const relPath = rel ? `${rel}/${entry}` : entry;
      if (entry.toLowerCase() === "index.md") out.push(relPath);
      else if (st.isDirectory()) out.push(...walk(fullPath, relPath));
    }
    return out;
  }

  for (const indexPath of walk(paths.wiki, "")) {
    if (indexPath === "index.md") continue;
    if (!currentIndexes.has(indexPath)) {
      const fullPath = join(paths.wiki, indexPath);
      try {
        if (lstatSync(fullPath).isSymbolicLink() || !isPathWithin(paths.wiki, fullPath)) continue;
        rmSync(fullPath);
      } catch {
        // Best-effort pruning.
      }
    }
  }
}

function readEventSource(filePath, diagPath = "meta/events.jsonl") {
  try {
    return { available: true, content: readFileSync(filePath, "utf8") };
  } catch (error) {
    const code = error?.code === "ENOENT" ? "event_source_missing" : "event_source_unreadable";
    const message =
      code === "event_source_missing"
        ? "Authoritative event source is missing; existing log projections were preserved"
        : "Authoritative event source is unreadable; existing log projections were preserved";
    return { available: false, diagnostic: okfDiag("warning", code, diagPath, message) };
  }
}

export function appendEvent(paths, event) {
  const writable = inspectWritableVault(paths);
  if (!writable.ok) {
    const err = new Error(writable.diagnostics[0].message);
    err.diagnostics = writable.diagnostics;
    throw err;
  }
  const { timestamp: _ignoredTs, kind: rawKind, ...details } = event ?? {};
  const kind = typeof rawKind === "string" ? rawKind.trim() : "";
  if (!kind) throw new Error("Event kind must be a non-empty string");
  mkdirSync(paths.meta, { recursive: true });
  const eventsPath = join(paths.meta, "events.jsonl");
  const line = JSON.stringify({ ...details, timestamp: new Date().toISOString(), kind });
  writeFileSync(eventsPath, `${line}\n`, { flag: "a", encoding: "utf8" });
}

/** Validate details supplied by external callers so reserved fields cannot be overridden. */
export function appendValidatedEvent(paths, kindInput, detailsInput) {
  const kind = typeof kindInput === "string" ? kindInput.trim() : "";
  if (!kind) {
    return { ok: false, message: "Event kind must be a non-empty string" };
  }
  const details = detailsInput ?? {};
  if (typeof details !== "object" || Array.isArray(details)) {
    return { ok: false, message: "Event details must be a JSON object" };
  }
  if (Object.hasOwn(details, "kind") || Object.hasOwn(details, "timestamp")) {
    return { ok: false, message: "Event details cannot override kind or timestamp" };
  }
  appendEvent(paths, { kind, ...details });
  const projection = rebuildMetadata(paths);
  return {
    ok: projection.ok,
    message: projection.ok
      ? `Event logged: ${kind}`
      : projection.diagnostics[0]?.message ?? "Failed to rebuild log projections",
    diagnostics: projection.diagnostics,
  };
}

/** Fail-closed metadata rebuild: computes all outputs in memory before writing anything. */
export function rebuildMetadata(paths) {
  const vaultState = inspectVaultFormat(paths);
  if (vaultState.blocking) {
    return { ok: false, diagnostics: vaultState.diagnostics };
  }

  const discovery = discoverKnowledgeDocuments(paths);
  if (discovery.blocking) {
    return { ok: false, diagnostics: discovery.diagnostics };
  }

  const documents = discovery.documents;
  const allDiagnostics = [...vaultState.diagnostics, ...discovery.diagnostics];
  const registry = buildRegistry(paths, documents);
  const wikilinkIndex = buildWikilinkIndex(documents.map((d) => d.id));
  const backlinks = buildBacklinks(documents, wikilinkIndex, allDiagnostics);

  const eventSource = readEventSource(join(paths.meta, "events.jsonl"));
  const eventLogResult = eventSource.available ? buildOkfLog(eventSource.content) : undefined;
  if (eventLogResult) allDiagnostics.push(...eventLogResult.diagnostics);
  else if (!eventSource.available) allDiagnostics.push(eventSource.diagnostic);

  const metaIndex = buildIndexMarkdown(registry);
  const metaLog = eventSource.available ? buildLogMarkdown(eventSource.content) : undefined;

  const okfIndexes =
    vaultState.knowledgeFormat === "okf-0.2"
      ? buildDirectoryIndexes(documents, readJson(join(paths.dotWiki, "config.json"), {}))
      : null;
  const okfLog =
    vaultState.knowledgeFormat === "okf-0.2" ? eventLogResult?.markdown : undefined;

  mkdirSync(paths.meta, { recursive: true });
  atomicWriteFile(join(paths.meta, "registry.json"), `${JSON.stringify(registry, null, 2)}\n`);
  atomicWriteFile(join(paths.meta, "backlinks.json"), `${JSON.stringify(backlinks, null, 2)}\n`);
  atomicWriteFile(join(paths.meta, "index.md"), metaIndex);
  if (metaLog !== undefined) atomicWriteFile(join(paths.meta, "log.md"), metaLog);

  if (okfIndexes && okfIndexes.size > 0) {
    mkdirSync(paths.wiki, { recursive: true });
    for (const [indexPath, content] of okfIndexes) {
      atomicWriteFile(join(paths.wiki, indexPath), content);
    }
    pruneObsoleteIndexes(paths, okfIndexes);
  }

  if (okfLog !== undefined) {
    mkdirSync(paths.wiki, { recursive: true });
    atomicWriteFile(join(paths.wiki, "log.md"), okfLog);
  }

  return {
    ok: true,
    diagnostics: allDiagnostics,
    registry,
    backlinks,
    pageCount: documents.length,
  };
}
