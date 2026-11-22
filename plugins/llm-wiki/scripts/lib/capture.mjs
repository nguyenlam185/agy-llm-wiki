import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { extractLocalFile, extractUrl } from "./extractors.mjs";
import { createKnowledgeDocument, serializeKnowledgeDocument } from "./frontmatter.mjs";
import { appendEvent, rebuildMetadata } from "./metadata.mjs";
import { ensureVaultStructure, fmtDate, nextSourceId, readJson, writeJson } from "./paths.mjs";
import { inspectWritableVault, readVaultConfig } from "./vault.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PLUGIN_TEMPLATES_DIR = join(__dirname, "..", "..", "templates");

function copyTemplatesIfMissing(srcDir, destDir) {
  if (!existsSync(srcDir)) return;
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const src = join(srcDir, entry.name);
    const dest = join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyTemplatesIfMissing(src, dest);
    } else if (!existsSync(dest)) {
      copyFileSync(src, dest);
    }
  }
}

export function initVault(paths, { topic, mode = "personal", templatesDir = DEFAULT_PLUGIN_TEMPLATES_DIR }) {
  const cleanTopic = String(topic ?? "").trim();
  if (!cleanTopic) {
    return { ok: false, error: "Topic is required for `init` (--topic)." };
  }
  if (mode !== "personal" && mode !== "company") {
    return { ok: false, error: `Invalid mode "${mode}". Use "personal" or "company".` };
  }

  const configPath = join(paths.dotWiki, "config.json");
  const created = !existsSync(configPath);
  let existing = {};

  if (!created) {
    const writable = inspectWritableVault(paths);
    if (!writable.ok) {
      return {
        ok: false,
        error: writable.diagnostics[0].message,
        diagnostics: writable.diagnostics,
      };
    }
    const cfgRes = readVaultConfig(paths);
    if (!cfgRes.ok) {
      return { ok: false, error: cfgRes.diagnostic.message, diagnostics: [cfgRes.diagnostic] };
    }
    existing = cfgRes.config;
  }

  ensureVaultStructure(paths);
  const config = {
    ...existing,
    name: cleanTopic,
    topic: cleanTopic,
    mode,
    created: existing.created ?? fmtDate(),
    version: existing.version ?? "1.0",
    vault_id: existing.vault_id ?? randomUUID(),
    knowledge_format: existing.knowledge_format ?? "okf-0.2",
  };
  writeJson(configPath, config);

  const schemaSrc = join(templatesDir, "WIKI_SCHEMA.md");
  const schemaDest = join(paths.dotWiki, "WIKI_SCHEMA.md");
  if (existsSync(schemaSrc) && (created || !existsSync(schemaDest))) {
    copyFileSync(schemaSrc, schemaDest);
  }
  copyTemplatesIfMissing(join(templatesDir, "pages"), paths.templatesPages);

  appendEvent(paths, { kind: "bootstrap", topic: cleanTopic, mode });
  const projection = rebuildMetadata(paths);
  if (!projection.ok) {
    return {
      ok: false,
      error: projection.diagnostics[0]?.message ?? "Failed to build initial metadata",
      diagnostics: projection.diagnostics,
    };
  }

  return {
    ok: true,
    created,
    root: paths.root,
    dotWiki: paths.dotWiki,
    topic: cleanTopic,
    mode,
    knowledgeFormat: config.knowledge_format,
    diagnostics: projection.diagnostics,
  };
}

function buildSourcePageSkeleton(manifest, extracted) {
  const id = String(manifest.id);
  const title = String(manifest.title || id);
  const originalLine = manifest.url ? `\n\n> _Original: [${manifest.url}](${manifest.url})_` : "";
  const format = String(manifest.format || "unknown");
  const captured = String(manifest.captured || fmtDate());

  const preview = String(extracted ?? "")
    .replace(/[#*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);

  const body = `# ${title}${originalLine}

## Summary

[LLM: Replace with 2-3 paragraph summary of key content]

> _Auto-preview: ${preview}${extracted.length > 500 ? "..." : ""}_

## Key Takeaways

- [LLM: Most important point]
- [LLM: Second important point]
- [LLM: Third important point]

## Entities Mentioned

- [LLM: Add linked entities after review]

## Concepts Mentioned

- [LLM: Add linked concepts after review]

## Notable Quotes

> [LLM: Important quote] — attribution

## Source Packet

- **ID:** \`sources/${id}\`
- **Extracted:** \`raw/sources/${id}/extracted.md\`
- **Manifest:** \`raw/sources/${id}/manifest.json\``;

  const doc = createKnowledgeDocument(
    `sources/${id}.md`,
    {
      type: "source",
      title,
      format,
      source_id: id,
      raw_path: `raw/sources/${id}/extracted.md`,
      captured,
      status: "skeleton",
    },
    body,
  );
  return serializeKnowledgeDocument(doc);
}

export async function captureSource(paths, input) {
  const writable = inspectWritableVault(paths);
  if (!writable.ok) {
    return { ok: false, error: writable.diagnostics[0].message, diagnostics: writable.diagnostics };
  }

  const hasUrl = Boolean(input.url && String(input.url).trim());
  const hasFile = Boolean(input.file && String(input.file).trim());
  const hasText = input.text !== undefined && input.text !== null && String(input.text).length > 0;
  const count = Number(hasUrl) + Number(hasFile) + Number(hasText);
  if (count === 0) {
    return { ok: false, error: "Provide one of: --url, --file, or text input (--text / --text-file / --stdin)." };
  }
  if (count > 1) {
    return { ok: false, error: "Provide only one input source per capture (--url, --file, or text)." };
  }

  if (hasFile && !existsSync(input.file)) {
    return { ok: false, error: `File not found: ${input.file}` };
  }

  const sourceId = nextSourceId(paths);
  const packetPath = join(paths.rawSources, sourceId);
  const originalDir = join(packetPath, "original");
  const attachmentsDir = join(packetPath, "attachments");

  mkdirSync(attachmentsDir, { recursive: true });
  if (hasUrl || hasFile) mkdirSync(originalDir, { recursive: true });

  let extractedResult;
  let manifestExtra = {};
  let eventExtra = {};

  try {
    if (hasUrl) {
      const url = String(input.url).trim();
      extractedResult = await extractUrl(url, originalDir);
      manifestExtra = { title: input.title || extractedResult.title || url, url, format: "web" };
      eventExtra = { url, format: "web" };
    } else if (hasFile) {
      const filePath = String(input.file).trim();
      extractedResult = await extractLocalFile(filePath, originalDir);
      // Omit machine-local absolute file path from public event logs; store only filename in event.
      manifestExtra = {
        title: input.title || extractedResult.title,
        format: extractedResult.format,
        original_file: extractedResult.title,
      };
      eventExtra = { format: extractedResult.format };
    } else {
      const text = String(input.text);
      extractedResult = {
        extracted: text,
        extractor: "passthrough",
        extraction_status: "success",
      };
      manifestExtra = {
        title: input.title || `Pasted text — ${fmtDate()}`,
        format: "text",
      };
      eventExtra = { format: "text" };
    }
  } catch (error) {
    rmSync(packetPath, { recursive: true, force: true });
    return { ok: false, error: error.message };
  }

  const extracted = extractedResult.extracted || "_No content extracted._\n";
  const manifest = {
    id: sourceId,
    captured: fmtDate(),
    packet_version: "1.0",
    ...manifestExtra,
    extractor: extractedResult.extractor ?? "passthrough",
    extraction_status: extractedResult.extraction_status ?? "success",
    ...(extractedResult.content_type ? { content_type: extractedResult.content_type } : {}),
  };

  writeFileSync(join(packetPath, "extracted.md"), extracted, "utf8");
  writeJson(join(packetPath, "manifest.json"), manifest);

  mkdirSync(join(paths.wiki, "sources"), { recursive: true });
  const sourcePagePath = join(paths.wiki, "sources", `${sourceId}.md`);
  writeFileSync(sourcePagePath, buildSourcePageSkeleton(manifest, extracted), "utf8");

  appendEvent(paths, { kind: "capture", source_id: sourceId, ...eventExtra });
  const projection = rebuildMetadata(paths);

  return {
    ok: projection.ok,
    sourceId,
    packetPath,
    extractedPath: join(packetPath, "extracted.md"),
    sourcePagePath,
    extractionStatus: manifest.extraction_status,
    extractor: manifest.extractor,
    title: manifest.title,
    extractedChars: extracted.length,
    diagnostics: projection.diagnostics,
    ...(projection.ok ? {} : { error: projection.diagnostics[0]?.message ?? "Projection rebuild failed" }),
  };
}

export function listPending(paths, { sourceId, batch = 3 } = {}) {
  const writable = inspectWritableVault(paths);
  if (!writable.ok) {
    return { ok: false, error: writable.diagnostics[0].message, diagnostics: writable.diagnostics };
  }

  if (!existsSync(paths.rawSources)) {
    return { ok: true, pending: [], totalPending: 0, remaining: 0 };
  }

  const packets = readdirSync(paths.rawSources)
    .filter((d) => d.startsWith("SRC-"))
    .sort();

  const registry = readJson(join(paths.meta, "registry.json"), { pages: {} });
  const ingested = new Set();
  for (const [id, entry] of Object.entries(registry.pages ?? {})) {
    if (entry?.type === "source" && entry?.status !== "skeleton") {
      const base = id.split("/").pop();
      if (base && existsSync(join(paths.wiki, "sources", `${base}.md`))) {
        ingested.add(base);
      }
    }
  }

  let toProcess = packets.filter((id) => !ingested.has(id));
  if (sourceId) {
    if (!packets.includes(sourceId)) {
      return { ok: false, error: `Source ${sourceId} not found in raw/sources/.` };
    }
    if (ingested.has(sourceId) && !toProcess.includes(sourceId)) {
      return { ok: false, error: `Source ${sourceId} is already synthesized.` };
    }
    toProcess = [sourceId];
  }

  const limit = Math.max(1, Math.min(Number(batch) || 3, 20));
  const selected = toProcess.slice(0, limit);
  const pending = selected.map((id) => {
    const manifest = readJson(join(paths.rawSources, id, "manifest.json"), {});
    const extractedPath = join(paths.rawSources, id, "extracted.md");
    const extractedChars = existsSync(extractedPath) ? readFileSync(extractedPath, "utf8").length : 0;
    return {
      id,
      title: manifest.title || id,
      format: manifest.format || "unknown",
      captured: manifest.captured || "",
      extractedPath,
      relativeExtractedPath: relative(paths.root, extractedPath),
      sourcePagePath: join(paths.wiki, "sources", `${id}.md`),
      relativeSourcePagePath: relative(paths.root, join(paths.wiki, "sources", `${id}.md`)),
      extractedChars,
      manifest,
    };
  });

  return {
    ok: true,
    pending,
    totalPending: toProcess.length,
    remaining: Math.max(0, toProcess.length - pending.length),
  };
}
