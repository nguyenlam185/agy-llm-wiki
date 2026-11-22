import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createKnowledgeDocument, serializeKnowledgeDocument } from "./frontmatter.mjs";
import { buildResolvedBacklinks, buildWikilinkIndex } from "./links.mjs";
import { appendEvent, rebuildMetadata } from "./metadata.mjs";
import { compareCodePoint, fmtDate, slugify, writeJson } from "./paths.mjs";
import { discoverKnowledgeDocuments, inspectVaultFormat, inspectWritableVault } from "./vault.mjs";

export function runWikiLint(paths, { autoFix = false } = {}) {
  const writable = inspectWritableVault(paths);
  if (!writable.ok) {
    return { ok: false, error: writable.diagnostics[0].message, diagnostics: writable.diagnostics };
  }

  if (autoFix) {
    const projection = rebuildMetadata(paths);
    if (!projection.ok) {
      return {
        ok: false,
        error: projection.diagnostics[0]?.message ?? "Projection-blocking diagnostics detected",
        diagnostics: projection.diagnostics,
      };
    }
  } else {
    const vault = inspectVaultFormat(paths);
    const audit = discoverKnowledgeDocuments(paths);
    const diagnostics = [...vault.diagnostics, ...audit.diagnostics];
    if (vault.blocking || audit.blocking) {
      return {
        ok: false,
        error: diagnostics[0]?.message ?? "Projection-blocking diagnostics detected",
        diagnostics,
      };
    }
  }

  const discovery = discoverKnowledgeDocuments(paths);
  const pages = discovery.documents;
  const wikilinkIndex = buildWikilinkIndex(pages.map((p) => p.id));
  const inbound = Object.fromEntries(pages.map((p) => [p.id, 0]));
  const gapSources = new Map();
  const findings = [];
  const contradictionPages = [];
  let missingPages = 0;
  let contradictions = 0;

  for (const page of pages) {
    const resolved = buildResolvedBacklinks(page.id, page.body, wikilinkIndex);
    for (const target of resolved.targets) inbound[target]++;
    for (const unresolved of resolved.unresolved) {
      const sources = gapSources.get(unresolved.target) ?? new Set();
      sources.add(page.id);
      gapSources.set(unresolved.target, sources);
      missingPages++;
      findings.push(`Missing page: ${unresolved.target} (in ${page.id})`);
    }
    for (const d of resolved.diagnostics) {
      if (d.code === "link_ambiguous") {
        findings.push(d.message.replace("Ambiguous wikilink: ", "Ambiguous: "));
      }
    }
  }

  let orphans = 0;
  for (const page of pages) {
    if (inbound[page.id] === 0) {
      orphans++;
      findings.push(`Orphan: ${page.id} has no inbound links`);
    }
    if (page.body.includes("⚠️ **Contradiction")) {
      contradictions++;
      contradictionPages.push(page.id);
      findings.push(`Contradiction flagged in ${page.id}`);
    }
  }

  const gaps = [...gapSources.entries()]
    .map(([topic, sources]) => ({ topic, mentionedBy: [...sources].sort(compareCodePoint) }))
    .sort((a, b) => compareCodePoint(a.topic, b.topic));

  let fixesApplied = 0;
  const createdStubs = [];
  if (autoFix) {
    for (const gap of gaps) {
      if (gap.mentionedBy.length < 2) continue;
      const parts = gap.topic.split("/");
      const name =
        parts.length === 1
          ? parts[0]
          : parts.length === 2 && parts[0] === "concepts"
            ? parts[1]
            : "";
      if (!name || slugify(name) !== name) continue;

      const stubPath = join(paths.wiki, "concepts", `${name}.md`);
      mkdirSync(join(paths.wiki, "concepts"), { recursive: true });
      const doc = createKnowledgeDocument(
        `concepts/${name}.md`,
        {
          type: "concept",
          title: name.replace(/-/g, " "),
          created: fmtDate(),
          updated: fmtDate(),
          status: "stub",
        },
        `_Stub auto-created by lint. Expand with content from: ${gap.mentionedBy
          .map((src) => `[${src}](/${src}.md)`)
          .join(", ")}_`,
      );
      try {
        writeFileSync(stubPath, serializeKnowledgeDocument(doc), { encoding: "utf8", flag: "wx" });
        fixesApplied++;
        createdStubs.push(`concepts/${name}`);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
    }
  }

  mkdirSync(paths.discoveries, { recursive: true });
  writeJson(join(paths.discoveries, "gaps.json"), {
    gaps,
    generated: new Date().toISOString(),
  });

  const reportLines = [
    "# Wiki Lint Report",
    `Generated: ${fmtDate()}`,
    "",
    "## Summary",
    `- Total pages: ${pages.length}`,
    `- Orphans: ${orphans}`,
    `- Missing pages: ${missingPages}`,
    `- Contradictions: ${contradictions}`,
    autoFix ? `- Missing-page fixes applied: ${fixesApplied}` : "",
    "",
    "## Findings",
    findings.length ? findings.map((f) => `- ${f}`).join("\n") : "✅ No issues found!",
    "",
  ].filter(Boolean);

  let reportPath;
  if (autoFix) {
    reportPath = join(paths.outputs, `lint-${fmtDate()}.md`);
    mkdirSync(paths.outputs, { recursive: true });
    writeFileSync(reportPath, `${reportLines.join("\n")}\n`, "utf8");
    appendEvent(paths, {
      kind: "lint",
      orphans,
      missing_pages: missingPages,
      contradictions,
      auto_fix: true,
      fixes_applied: fixesApplied,
    });
    rebuildMetadata(paths);
  }

  return {
    ok: true,
    totalPages: pages.length,
    orphans,
    missingPages,
    contradictions,
    contradictionPages,
    gapsCount: gaps.length,
    gaps,
    fixesApplied,
    createdStubs,
    reportPath,
    findings,
  };
}
