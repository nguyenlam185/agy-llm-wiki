import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listPending } from "./capture.mjs";
import { readJson } from "./paths.mjs";
import { discoverKnowledgeDocuments, inspectVaultFormat, inspectWritableVault, readVaultConfig } from "./vault.mjs";

export function getWikiStatus(paths) {
  const writable = inspectWritableVault(paths);
  if (!writable.ok) {
    return { ok: false, error: writable.diagnostics[0].message, diagnostics: writable.diagnostics };
  }

  const cfgRes = readVaultConfig(paths);
  const config = cfgRes.ok ? cfgRes.config : {};
  const formatState = inspectVaultFormat(paths);
  const discovery = discoverKnowledgeDocuments(paths);
  const diagnostics = [...formatState.diagnostics, ...discovery.diagnostics];

  const registry = readJson(join(paths.meta, "registry.json"), {
    version: "1.0",
    last_updated: "",
    pages: {},
  });

  const byType = {};
  let totalPages = 0;
  for (const entry of Object.values(registry.pages ?? {})) {
    totalPages++;
    const t = String(entry?.type || "unknown");
    byType[t] = (byType[t] ?? 0) + 1;
  }

  const backlinks = readJson(join(paths.meta, "backlinks.json"), {});
  const orphans = Object.values(backlinks).filter((arr) => Array.isArray(arr) && arr.length === 0).length;

  const gapsDoc = readJson(join(paths.discoveries, "gaps.json"), { gaps: [] });
  const trackedGaps = Array.isArray(gapsDoc.gaps) ? gapsDoc.gaps.length : 0;

  let rawPacketCount = 0;
  if (existsSync(paths.rawSources)) {
    rawPacketCount = readdirSync(paths.rawSources).filter((d) => d.startsWith("SRC-")).length;
  }
  const pendingRes = listPending(paths, { batch: 20 });
  const pendingSources = pendingRes.ok ? pendingRes.totalPending : 0;

  const recentEvents = [];
  const eventsPath = join(paths.meta, "events.jsonl");
  if (existsSync(eventsPath)) {
    const lines = readFileSync(eventsPath, "utf8")
      .split("\n")
      .filter((l) => l.trim());
    for (const line of lines.slice(-10)) {
      try {
        recentEvents.push(JSON.parse(line));
      } catch {
        // skip malformed lines
      }
    }
  }

  return {
    ok: true,
    root: paths.root,
    topic: config.topic ?? "",
    mode: config.mode ?? "personal",
    knowledgeFormat: formatState.knowledgeFormat,
    totalPages,
    byType,
    rawPackets: rawPacketCount,
    pendingSources,
    orphans,
    trackedGaps,
    lastUpdated: registry.last_updated || "",
    recentEvents,
    blockingDiagnostics: diagnostics.filter((d) => d.severity === "error"),
    warnings: diagnostics.filter((d) => d.severity === "warning"),
  };
}
