import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createKnowledgeDocument,
  FRONTMATTER_MAX_BYTES,
  parseKnowledgeDocument,
  parseMarkdownFrontmatter,
  serializeKnowledgeDocument,
} from "../plugins/llm-wiki/scripts/lib/frontmatter.mjs";
import {
  applyWikilinkGate,
  buildResolvedBacklinks,
  buildWikilinkIndex,
  extractKnowledgeLinks,
} from "../plugins/llm-wiki/scripts/lib/links.mjs";
import {
  appendEvent,
  appendValidatedEvent,
  rebuildMetadata,
} from "../plugins/llm-wiki/scripts/lib/metadata.mjs";
import {
  ensureVaultStructure,
  getVaultPaths,
  isPathWithin,
  nextSourceId,
  resolveVaultRoot,
  slugify,
  writeJson,
} from "../plugins/llm-wiki/scripts/lib/paths.mjs";

function makeTempDir(prefix = "llm-wiki-core-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

function initMinimalVault(root, format = "okf-0.2") {
  const paths = getVaultPaths(root);
  ensureVaultStructure(paths);
  writeJson(join(paths.dotWiki, "config.json"), {
    name: "Test Wiki",
    topic: "Testing",
    mode: "personal",
    knowledge_format: format,
  });
  return paths;
}

test("paths: resolveVaultRoot finds ancestor workspace vault and never falls back to HOME or WIKI_HOME", () => {
  const base = makeTempDir();
  const prevWikiHome = process.env.WIKI_HOME;
  try {
    const workspace = join(base, "repo");
    const nested = join(workspace, "a", "b", "c");
    mkdirSync(nested, { recursive: true });
    initMinimalVault(workspace);

    assert.equal(resolveVaultRoot(nested), workspace);
    assert.equal(resolveVaultRoot(nested, workspace), workspace);

    // Explicit root without vault returns null even when cwd has an ancestor vault.
    const emptyDir = join(base, "empty");
    mkdirSync(emptyDir, { recursive: true });
    assert.equal(resolveVaultRoot(nested, emptyDir), null);

    // WIKI_HOME and $HOME/.llm-wiki must be ignored.
    const fakePersonal = join(base, "fake-personal");
    initMinimalVault(fakePersonal);
    process.env.WIKI_HOME = fakePersonal;
    assert.equal(resolveVaultRoot(emptyDir), null);

    // Stopping before os.homedir() ensures $HOME/.llm-wiki is never returned.
    assert.equal(resolveVaultRoot(homedir()), null);
  } finally {
    if (prevWikiHome === undefined) delete process.env.WIKI_HOME;
    else process.env.WIKI_HOME = prevWikiHome;
    rmSync(base, { recursive: true, force: true });
  }
});

test("paths: slugify, nextSourceId, and isPathWithin handle edge cases", () => {
  assert.equal(slugify("Retrieval Augmented Generation"), "retrieval-augmented-generation");
  assert.equal(slugify("ＡＢＣ　Test!"), "abc-test");
  assert.equal(slugify("日本語 テスト"), "日本語-テスト");
  assert.equal(slugify("CON"), "_con");
  assert.equal(slugify("index"), "index-page");
  assert.equal(slugify("log"), "log-page");
  assert.equal(slugify("   "), "untitled");

  const base = makeTempDir();
  try {
    const paths = initMinimalVault(base);
    const fixedDate = new Date("2026-11-22T01:02:03Z");
    assert.equal(nextSourceId(paths, fixedDate), "SRC-2026-11-22-001");
    mkdirSync(join(paths.rawSources, "SRC-2026-11-22-001"), { recursive: true });
    mkdirSync(join(paths.rawSources, "SRC-2026-11-22-002"), { recursive: true });
    assert.equal(nextSourceId(paths, fixedDate), "SRC-2026-11-22-003");

    assert.equal(isPathWithin(paths.wiki, join(paths.wiki, "concepts", "rag.md")), true);
    assert.equal(isPathWithin(paths.wiki, join(paths.raw, "secret.txt")), false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("frontmatter: parses OKF YAML subset, serializes cleanly, and enforces security diagnostics", () => {
  const sample = [
    "---",
    "type: concept",
    'title: "RAG: Overview"',
    "tags: [ai, search]",
    "nested:",
    "  confidence: high",
    "  score: 0.95",
    "sources:",
    "  - sources/SRC-2026-11-22-001",
    "---",
    "",
    "# RAG Overview",
    "",
    "Body text.",
  ].join("\n");

  const parsed = parseKnowledgeDocument(sample, "concepts/rag.md");
  assert.equal(parsed.ok, true);
  assert.equal(parsed.document.frontmatter.type, "concept");
  assert.equal(parsed.document.frontmatter.title, "RAG: Overview");
  assert.deepEqual(parsed.document.frontmatter.tags, ["ai", "search"]);
  assert.deepEqual(parsed.document.extensions.nested, { confidence: "high", score: 0.95 });
  assert.equal(parsed.document.sources.kind, "legacy-list");

  const doc = createKnowledgeDocument(
    "concepts/rag.md",
    { type: "concept", title: "RAG", tags: ["retrieval", "llm"] },
    "See [[entities/openai|OpenAI]]\n\n| Name | Link |\n| --- | --- |\n| OAI | [[entities/openai|OpenAI]] |",
  );
  const serialized = serializeKnowledgeDocument(doc);
  assert.match(serialized, /\[\[entities\/openai\\\|OpenAI\]\]/);
  const reparsed = parseKnowledgeDocument(serialized, "concepts/rag.md");
  assert.equal(reparsed.ok, true);
  assert.deepEqual(reparsed.document.frontmatter.tags, ["retrieval", "llm"]);

  // Error & security diagnostics
  assert.equal(parseMarkdownFrontmatter("# No frontmatter", "a.md").diagnostics[0].code, "frontmatter_missing");
  assert.equal(
    parseMarkdownFrontmatter("---\ntype: concept\n", "a.md").diagnostics[0].code,
    "frontmatter_parse_error",
  );
  assert.equal(
    parseMarkdownFrontmatter("---\ntype: concept\ntype: entity\n---\n", "a.md").diagnostics[0].code,
    "frontmatter_duplicate_key",
  );
  assert.equal(
    parseMarkdownFrontmatter("---\ntype: concept\nref: *alias\n---\n", "a.md").diagnostics[0].code,
    "frontmatter_alias_forbidden",
  );
  assert.equal(
    parseMarkdownFrontmatter("---\ntype: concept\ntag: !custom foo\n---\n", "a.md").diagnostics[0].code,
    "frontmatter_custom_tag_forbidden",
  );
  assert.equal(
    parseMarkdownFrontmatter("---\ntype: concept\n...\n---\nother: 1\n---\n", "a.md").diagnostics[0]
      .code,
    "frontmatter_multiple_documents",
  );
  assert.equal(
    parseKnowledgeDocument("---\ntitle: Missing Type\n---\n", "a.md").diagnostics[0].code,
    "concept_missing_type",
  );

  const oversized = `---\ntype: concept\nbig: "${"x".repeat(FRONTMATTER_MAX_BYTES)}"\n---\n`;
  assert.equal(parseMarkdownFrontmatter(oversized, "a.md").diagnostics[0].code, "frontmatter_limit_bytes");

  let deepYaml = "---\ntype: concept\n";
  for (let d = 0; d < 35; d++) deepYaml += `${"  ".repeat(d)}k${d}:\n`;
  deepYaml += `${"  ".repeat(35)}leaf: 1\n---\n`;
  assert.equal(parseMarkdownFrontmatter(deepYaml, "a.md").diagnostics[0].code, "frontmatter_limit_depth");
});

test("links: extracts wikilinks & Markdown links while masking code spans and fenced blocks", () => {
  const body = [
    "Prose links: [[entities/openai|OpenAI]], [RAG](/concepts/rag.md), and [Ref][ref1].",
    "Table: | [[concepts/rag\\|RAG]] |",
    "Inline code `[[ignored/inline]]` and ``[ignored](/concepts/ignored.md)``.",
    "",
    "```markdown",
    "[[ignored/fence]]",
    "[ignored](/concepts/fence.md)",
    "```",
    "",
    "External [web](https://example.com) and escape [bad](../../outside.md).",
    "",
    "[ref1]: ../entities/anthropic.md",
  ].join("\n");

  const extracted = extractKnowledgeLinks(body);
  assert.deepEqual(
    extracted.wikilinks.map((l) => l.target),
    ["entities/openai", "concepts/rag"],
  );
  assert.deepEqual(
    extracted.markdown.map((l) => l.target),
    ["/concepts/rag.md", "https://example.com", "../../outside.md", "../entities/anthropic.md"],
  );

  const idx = buildWikilinkIndex(["entities/openai", "entities/anthropic", "concepts/rag", "concepts/dup", "entities/dup"]);
  const resolved = buildResolvedBacklinks("sources/SRC-1", body, idx);
  assert.deepEqual(resolved.targets, ["concepts/rag", "entities/anthropic", "entities/openai"]);
  assert.equal(
    resolved.diagnostics.some((d) => d.code === "link_path_escape"),
    true,
  );

  const gateStrict = applyWikilinkGate("[[dup]] and [[missing]]", idx, "concepts/test", "strict");
  assert.equal(gateStrict.ok, false);
  assert.equal(gateStrict.diagnostics.some((d) => d.code === "link_ambiguous"), true);
  assert.equal(gateStrict.diagnostics.some((d) => d.code === "link_unresolved"), true);

  const gateNorm = applyWikilinkGate("See [[OpenAI|OAI]]", idx, "concepts/test", "normalize");
  assert.equal(gateNorm.ok, true);
  assert.equal(gateNorm.body, "See [[entities/openai|OAI]]");
});

test("metadata: rebuildMetadata writes atomic OKF projections and fails closed on corrupt pages", () => {
  const base = makeTempDir();
  try {
    const paths = initMinimalVault(base, "okf-0.2");
    writeFileSync(
      join(paths.wiki, "concepts", "rag.md"),
      "---\ntype: concept\ntitle: RAG\ncreated: 2026-11-22\n---\n\nSee [[entities/openai]].\n",
      "utf8",
    );
    writeFileSync(
      join(paths.wiki, "entities", "openai.md"),
      "---\ntype: entity\ntitle: OpenAI\ncreated: 2026-11-22\n---\n\nEntity body.\n",
      "utf8",
    );

    appendEvent(paths, { kind: "bootstrap", topic: "Testing" });
    const badLog = appendValidatedEvent(paths, "query", { kind: "spoof" });
    assert.equal(badLog.ok, false);

    const rebuilt = rebuildMetadata(paths);
    assert.equal(rebuilt.ok, true);
    assert.equal(rebuilt.pageCount, 2);

    const registry = JSON.parse(readFileSync(join(paths.meta, "registry.json"), "utf8"));
    assert.equal(registry.pages["concepts/rag"].title, "RAG");
    assert.equal(registry.pages["entities/openai"].title, "OpenAI");

    const backlinks = JSON.parse(readFileSync(join(paths.meta, "backlinks.json"), "utf8"));
    assert.deepEqual(backlinks["entities/openai"], ["concepts/rag"]);

    const rootIndex = readFileSync(join(paths.wiki, "index.md"), "utf8");
    assert.match(rootIndex, /okf_version: "0.2"/);
    assert.equal(existsSync(join(paths.wiki, "concepts", "index.md")), true);
    assert.equal(existsSync(join(paths.wiki, "log.md")), true);

    // Corrupt a page and verify fail-closed preserves existing registry.json.
    const prevRegistryRaw = readFileSync(join(paths.meta, "registry.json"), "utf8");
    writeFileSync(join(paths.wiki, "concepts", "broken.md"), "# Missing Frontmatter\n", "utf8");
    const failed = rebuildMetadata(paths);
    assert.equal(failed.ok, false);
    assert.equal(failed.diagnostics[0].code, "frontmatter_missing");
    assert.equal(readFileSync(join(paths.meta, "registry.json"), "utf8"), prevRegistryRaw);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
