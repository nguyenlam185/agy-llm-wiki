#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { captureSource, initVault, listPending } from "./lib/capture.mjs";
import { ensurePage } from "./lib/ensure.mjs";
import { runWikiLint } from "./lib/lint.mjs";
import { appendValidatedEvent, rebuildMetadata } from "./lib/metadata.mjs";
import { getVaultPaths, resolveInitRoot, resolveVaultRoot } from "./lib/paths.mjs";
import { searchWiki } from "./lib/search.mjs";
import { getWikiStatus } from "./lib/status.mjs";

const USAGE = `Usage: wiki.mjs <command> [options]

Commands:
  init       --topic <topic> [--mode personal|company]
  capture    (--url <url> | --file <path> | --text <str> | --text-file <path> | --stdin) [--title <title>]
  pending    [--source-id <id>] [--batch <n>]
  ensure     --type <type> --title <title> [--body <md> | --body-file <path> | --stdin]
  search     <query> [--type <type>] [--max <n>] [--links-only] [--inline]
  lint       [--fix]
  status
  rebuild
  log        --kind <kind> [--details <json>]

Global options:
  --root <dir>   Target workspace directory explicitly
  --json         Emit machine-readable JSON output
  --help, -h     Show this help`;

const BOOLEAN_FLAGS = new Set(["json", "help", "fix", "links-only", "inline", "stdin"]);

function parseArgs(argv) {
  const positionals = [];
  const flags = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h") {
      flags.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const eqIdx = arg.indexOf("=");
    if (eqIdx !== -1) {
      const key = arg.slice(2, eqIdx);
      flags[key] = arg.slice(eqIdx + 1);
      continue;
    }
    const key = arg.slice(2);
    if (BOOLEAN_FLAGS.has(key)) {
      flags[key] = true;
    } else {
      const next = argv[i + 1];
      if (next === undefined) {
        throw new Error(`Missing value for --${key}`);
      }
      flags[key] = next;
      i++;
    }
  }

  return { command: positionals[0] ?? "", args: positionals.slice(1), flags };
}

function readStdinText() {
  return readFileSync(0, "utf8");
}

function outResult(jsonMode, payload, markdownLines) {
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`${markdownLines.join("\n")}\n`);
  }
}

function fail(jsonMode, message, extra = {}) {
  const payload = { ok: false, error: message, ...extra };
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stderr.write(`Error: ${message}\n`);
  }
  process.exit(1);
}

function requirePaths(explicitRoot, jsonMode) {
  const root = resolveVaultRoot(process.cwd(), explicitRoot);
  if (!root) {
    fail(jsonMode, "No workspace wiki vault found. Run `wiki.mjs init --topic <topic>` first.");
  }
  return getVaultPaths(root);
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    fail(process.argv.includes("--json"), error.message);
  }

  const { command, args, flags } = parsed;
  const jsonMode = Boolean(flags.json);

  if (flags.help || !command || command === "help") {
    if (jsonMode) outResult(true, { ok: true, usage: USAGE }, []);
    else process.stdout.write(`${USAGE}\n`);
    return;
  }

  if (command === "init") {
    const root = resolveInitRoot(process.cwd(), flags.root);
    const paths = getVaultPaths(root);
    const res = initVault(paths, { topic: flags.topic, mode: flags.mode || "personal" });
    if (!res.ok) fail(jsonMode, res.error, { diagnostics: res.diagnostics });
    outResult(jsonMode, res, [
      `✅ ${res.created ? "Initialized" : "Updated"} workspace LLM Wiki at \`${res.root}\``,
      `- Topic: ${res.topic}`,
      `- Mode: ${res.mode} (${res.knowledgeFormat})`,
      `- Vault dir: \`${res.dotWiki}\``,
    ]);
    return;
  }

  const paths = requirePaths(flags.root, jsonMode);

  if (command === "capture") {
    let text = flags.text;
    if (flags["text-file"]) text = readFileSync(String(flags["text-file"]), "utf8");
    else if (flags.stdin || flags.text === "-") text = readStdinText();

    const res = await captureSource(paths, {
      url: flags.url,
      file: flags.file,
      text,
      title: flags.title,
    });
    if (!res.ok) fail(jsonMode, res.error, { diagnostics: res.diagnostics });
    outResult(jsonMode, res, [
      `✅ Captured **${res.sourceId}** (${res.title})`,
      `- Packet: \`${res.packetPath}\``,
      `- Extracted: \`${res.extractedPath}\` (${res.extractedChars} chars, ${res.extractor}: ${res.extractionStatus})`,
      `- Skeleton page: \`${res.sourcePagePath}\``,
    ]);
    return;
  }

  if (command === "pending") {
    const res = listPending(paths, {
      sourceId: flags["source-id"],
      batch: flags.batch ? Number(flags.batch) : 3,
    });
    if (!res.ok) fail(jsonMode, res.error, { diagnostics: res.diagnostics });
    if (res.pending.length === 0) {
      outResult(jsonMode, res, ["✅ All captured sources are synthesized."]);
      return;
    }
    outResult(jsonMode, res, [
      `📥 **${res.pending.length} pending source(s)** (${res.remaining} remaining)`,
      "",
      ...res.pending.map(
        (p) =>
          `- **${p.id}**: ${p.title} (${p.extractedChars} chars)\n  - Extracted: \`${p.relativeExtractedPath}\`\n  - Page: \`${p.relativeSourcePagePath}\``,
      ),
    ]);
    return;
  }

  if (command === "ensure") {
    let body = flags.body;
    if (flags["body-file"]) body = readFileSync(String(flags["body-file"]), "utf8");
    else if (flags.stdin || flags.body === "-") body = readStdinText();

    const res = ensurePage(paths, { type: flags.type, title: flags.title, body });
    if (!res.ok) fail(jsonMode, res.error, { diagnostics: res.diagnostics });
    const warnLines =
      res.wikilinkIssues?.length > 0
        ? ["", `⚠️ ${res.wikilinkIssues.length} wikilink issue(s):`, ...res.wikilinkIssues.map((m) => `- ${m}`)]
        : [];
    outResult(jsonMode, res, [
      res.created ? `✅ Created \`${res.id}\` at \`${res.path}\`` : `✅ Page already exists: \`${res.path}\``,
      ...warnLines,
    ]);
    return;
  }

  if (command === "search") {
    const query = args.join(" ").trim() || String(flags.query ?? "").trim();
    if (!query) fail(jsonMode, "Search query is required.");
    const res = searchWiki(paths, {
      query,
      type: flags.type,
      max: flags.max ? Number(flags.max) : 5,
      linksOnly: Boolean(flags["links-only"]),
      inline: Boolean(flags.inline),
    });
    if (!res.ok) fail(jsonMode, res.error, { diagnostics: res.diagnostics });
    if (res.results.length === 0) {
      outResult(jsonMode, res, [`No wiki pages matched "${query}".`]);
      return;
    }
    const header = res.linksOnly
      ? `🔍 **Matches for "${query}"** (links-first mode, ${res.totalPages} total pages):`
      : `🔍 **Matches for "${query}"**:`;
    outResult(jsonMode, res, [
      header,
      "",
      ...res.results.map((r) =>
        res.linksOnly
          ? `- [[${r.id}]] — **${r.title}** (${r.type}, score ${r.score}) — \`${r.path}\`${r.snippet ? `\n  ${r.snippet}` : ""}`
          : `- [[${r.id}]] — **${r.title}** (${r.type}, score ${r.score})\n  - Path: \`${r.path}\`\n  - Preview: ${r.preview}`,
      ),
    ]);
    return;
  }

  if (command === "lint") {
    const res = runWikiLint(paths, { autoFix: Boolean(flags.fix) });
    if (!res.ok) fail(jsonMode, res.error, { diagnostics: res.diagnostics });
    outResult(jsonMode, res, [
      "🧹 **LLM Wiki lint complete**",
      "",
      `- Pages: ${res.totalPages}`,
      `- Orphans: ${res.orphans}`,
      `- Missing: ${res.missingPages}`,
      `- Contradictions: ${res.contradictions}`,
      ...(flags.fix ? [`- Stub fixes applied: ${res.fixesApplied}`, `- Report: \`${res.reportPath}\``] : []),
      ...(res.gapsCount ? [`- Tracked gaps: ${res.gapsCount}`] : []),
      ...(res.findings.length ? ["", "## Findings", ...res.findings.map((f) => `- ${f}`)] : ["", "✅ No issues found!"]),
    ]);
    return;
  }

  if (command === "status") {
    const res = getWikiStatus(paths);
    if (!res.ok) fail(jsonMode, res.error, { diagnostics: res.diagnostics });
    const typesLine =
      Object.entries(res.byType)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ") || "none";
    outResult(jsonMode, res, [
      `📊 **LLM Wiki Status** — \`${res.root}\``,
      "",
      `- Topic: ${res.topic || "(unset)"} (${res.mode}, ${res.knowledgeFormat})`,
      `- Total pages: ${res.totalPages} (${typesLine})`,
      `- Pending raw sources: ${res.pendingSources} (of ${res.rawPackets} captured)`,
      `- Orphans: ${res.orphans}`,
      `- Tracked gaps: ${res.trackedGaps}`,
      `- Last updated: ${res.lastUpdated || "never"}`,
    ]);
    return;
  }

  if (command === "rebuild") {
    const res = rebuildMetadata(paths);
    if (!res.ok) fail(jsonMode, res.diagnostics[0]?.message ?? "Rebuild failed", { diagnostics: res.diagnostics });
    outResult(jsonMode, { ok: true, pageCount: res.pageCount, diagnostics: res.diagnostics }, [
      `✅ Metadata rebuilt — ${res.pageCount} page(s) indexed.`,
      ...(res.diagnostics.length
        ? ["", ...res.diagnostics.map((d) => `⚠️ ${d.code} (${d.path}): ${d.message}`)]
        : []),
    ]);
    return;
  }

  if (command === "log") {
    let details;
    if (flags.details) {
      try {
        details = JSON.parse(String(flags.details));
      } catch (error) {
        fail(jsonMode, `Invalid JSON in --details: ${error.message}`);
      }
    }
    const res = appendValidatedEvent(paths, flags.kind, details);
    if (!res.ok) fail(jsonMode, res.message, { diagnostics: res.diagnostics });
    outResult(jsonMode, res, [`✅ ${res.message}`]);
    return;
  }

  fail(jsonMode, `Unknown command: ${command}`);
}

main().catch((error) => {
  const jsonMode = process.argv.includes("--json");
  fail(jsonMode, error?.message ?? String(error));
});
