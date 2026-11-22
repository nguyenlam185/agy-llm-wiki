import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  createKnowledgeDocument,
  parseMarkdownFrontmatter,
  RESERVED_FRONTMATTER,
  writeKnowledgeDocumentFile,
} from "./frontmatter.mjs";
import { applyWikilinkGate, buildWikilinkIndex } from "./links.mjs";
import { appendEvent, rebuildMetadata } from "./metadata.mjs";
import { fmtDate, readJson, slugify } from "./paths.mjs";
import { inspectWritableVault, readVaultConfig } from "./vault.mjs";

const BUILTIN_FOLDERS = {
  entity: "entities",
  concept: "concepts",
  synthesis: "syntheses",
  analysis: "analyses",
  requirement: "requirements",
};

const VALID_LINK_MODES = new Set(["off", "warn", "strict", "normalize"]);

export function buildPageBody(type, title) {
  if (type === "entity") {
    return `# ${title}

One-line description.

## Overview

[Key facts and significance]

## Links

- [related-page](/concepts/related-page.md)`;
  }
  if (type === "concept") {
    return `# ${title}

One-line definition.

## Definition

[Clear explanation]

## Links

- [related-page](/concepts/related-page.md)`;
  }
  if (type === "synthesis") {
    return `# ${title}

Cross-cutting analysis.

## Question

[What drove this synthesis?]

## Analysis

[Findings and tensions]

## Links

- [related-page](/concepts/related-page.md)`;
  }
  if (type === "analysis") {
    return `# ${title}

Durable answer derived from wiki content.

## Question

[Original question]

## Answer

[Synthesized answer with citations]

## Links

- [related-page](/concepts/related-page.md)`;
  }
  if (type === "requirement") {
    return `# ${title}

## Description

[Independently verifiable behavior]

## Acceptance Criteria

- [ ] [Criterion 1]`;
  }
  return `# ${title}

[Content]`;
}

export function ensurePage(paths, { type, title, body }) {
  const writable = inspectWritableVault(paths);
  if (!writable.ok) {
    return { ok: false, error: writable.diagnostics[0].message, diagnostics: writable.diagnostics };
  }

  const cleanType = String(type ?? "").trim();
  const cleanTitle = String(title ?? "").trim();
  if (!cleanType) return { ok: false, error: "Page type is required (--type)." };
  if (!cleanTitle) return { ok: false, error: "Page title is required (--title)." };

  const cfgRes = readVaultConfig(paths);
  const config = cfgRes.ok ? cfgRes.config : {};
  const customTypes =
    config.customTypes && typeof config.customTypes === "object" && !Array.isArray(config.customTypes)
      ? config.customTypes
      : {};
  const folderMap = { ...BUILTIN_FOLDERS, ...customTypes };
  const folder = String(folderMap[cleanType] || "concepts").replace(/^\/+|\/+$/g, "");
  const slug = slugify(cleanTitle);
  const id = `${folder}/${slug}`;
  const pagePath = join(paths.wiki, folder, `${slug}.md`);

  if (existsSync(pagePath)) {
    return { ok: true, created: false, id, path: pagePath, wikilinkIssues: [] };
  }

  const today = fmtDate();
  let pageBody = body !== undefined && body !== null && String(body).length > 0
    ? String(body)
    : buildPageBody(cleanType, cleanTitle);

  const extraFrontmatter = {};
  if (pageBody.trimStart().startsWith("---")) {
    const parsed = parseMarkdownFrontmatter(pageBody, `${folder}/${slug}.md`);
    if (parsed.ok) {
      for (const [key, value] of Object.entries(parsed.mapping)) {
        if (!RESERVED_FRONTMATTER.has(key)) {
          Object.defineProperty(extraFrontmatter, key, {
            value,
            enumerable: true,
            writable: true,
            configurable: true,
          });
        }
      }
      pageBody = parsed.body.trim() ? parsed.body : buildPageBody(cleanType, cleanTitle);
    }
  }

  const rawMode = config.wikilinkValidation;
  const linkMode = VALID_LINK_MODES.has(rawMode) ? rawMode : "warn";
  const registry = readJson(join(paths.meta, "registry.json"), { pages: {} });
  const gate = applyWikilinkGate(
    pageBody,
    buildWikilinkIndex(Object.keys(registry.pages ?? {})),
    id,
    linkMode,
  );
  if (!gate.ok) {
    return {
      ok: false,
      error: `Rejected write due to unresolved/ambiguous wikilinks: ${gate.diagnostics.map((d) => d.message).join("; ")}`,
      diagnostics: gate.diagnostics,
    };
  }
  if (linkMode === "normalize") pageBody = gate.body;

  const doc = createKnowledgeDocument(
    `${folder}/${slug}.md`,
    {
      type: cleanType,
      title: cleanTitle,
      created: today,
      updated: today,
      ...extraFrontmatter,
    },
    pageBody,
  );

  mkdirSync(join(paths.wiki, folder), { recursive: true });
  writeKnowledgeDocumentFile(pagePath, doc);

  appendEvent(paths, {
    kind: "ensure_page",
    page_type: cleanType,
    title: cleanTitle,
    path: id,
  });

  const projection = rebuildMetadata(paths);
  if (!projection.ok) {
    return {
      ok: false,
      error: projection.diagnostics[0]?.message ?? "Failed to rebuild metadata",
      diagnostics: projection.diagnostics,
    };
  }

  return {
    ok: true,
    created: true,
    id,
    path: pagePath,
    wikilinkIssues: gate.diagnostics.map((d) => d.message),
  };
}
