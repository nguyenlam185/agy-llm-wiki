# Tasks

## 1. Plugin Scaffold & Unified Templates

- [x] 1.1 Create `plugins/llm-wiki/plugin.json` with `name: "llm-wiki"`, `displayName: "LLM Wiki"`, `description`, `version`, and three `suggestedPrompts` only; verify JSON parses cleanly with no unsupported top-level keys and no `hooks.json`, `mcp_config.json`, `rules/`, `.claude-plugin/`, `.pi/`, or `.omp/` files.
- [x] 1.2 Create unified OKF v0.2 + Obsidian templates under `plugins/llm-wiki/templates/` (`WIKI_SCHEMA.md`, `pages/source.md`, `pages/entity.md`, `pages/concept.md`, `pages/synthesis.md`, `pages/analysis.md`, `pages/requirement.md`); verify all templates cite `raw/sources/SRC-YYYY-MM-DD-NNN/` and folder-qualified links with zero legacy `raw/articles/` references.

## 2. Core CLI Foundation Modules & Tests

- [x] 2.1 Implement `plugins/llm-wiki/scripts/lib/paths.mjs` for strict workspace-local vault discovery (`--root` or upward walk stopping before `os.homedir()`, ignoring `~/.llm-wiki/` and `WIKI_HOME`), `.llm-wiki/` path layout, `slugify` (full-width folding, CJK preservation, Windows device guards, `index`/`log` suffixing), sequential `SRC-YYYY-MM-DD-NNN` IDs, and symlink-safe `isPathWithin` containment.
- [x] 2.2 Implement `plugins/llm-wiki/scripts/lib/frontmatter.mjs` for strict OKF YAML frontmatter parsing and serialization (scalars, sequences, nested maps, inline arrays/objects, 128 KB / depth-32 limits, rejecting aliases, custom tags, duplicate keys, and multi-document frontmatter).
- [x] 2.3 Implement `plugins/llm-wiki/scripts/lib/links.mjs` for code-span and fenced-code masking, dual extraction of `[[target]]` / `[[target\|alias]]` wikilinks and `[label](path.md)` Markdown links, normalized target resolution, and pre-write wikilink auditing.
- [x] 2.4 Implement `plugins/llm-wiki/scripts/lib/vault.mjs` and `plugins/llm-wiki/scripts/lib/metadata.mjs` for `config.json` and `okf-0.2` validation, `wiki/` document discovery excluding reserved `index.md` / `log.md`, fail-closed atomic temp-rename writes of `meta/{registry.json,backlinks.json,index.md,log.md}` and OKF `wiki/index.md` / subdir indexes / `wiki/log.md`, and append-only `meta/events.jsonl` logging.
- [x] 2.5 Write unit tests in `test/core-foundation.test.mjs` covering tasks 2.1–2.4 (ancestor resolution, non-fallback when `~/.llm-wiki/` exists, slugify edge cases, YAML security limits/errors, link extraction skipping code blocks, fail-closed `rebuild`, and `events.jsonl` protection) and verify all tests pass via `node --test test/core-foundation.test.mjs`.

## 3. Source Capture, Extraction, Page Operations, Search, Lint & CLI Entrypoint

- [x] 3.1 Implement `plugins/llm-wiki/scripts/lib/extractors.mjs` with magic-byte binary detection, JSON/XML/HTML-to-Markdown normalizers, URL `fetch` with timeout/content-type handling, and safe `execFile` PDF/DOCX extraction probing `markitdown`/`uvx` and falling back to `pdftotext` (PDF) and `python3` `zipfile` XML extraction (DOCX).
- [x] 3.2 Implement `plugins/llm-wiki/scripts/lib/capture.mjs` for `init` scaffolding, immutable `raw/sources/SRC-YYYY-MM-DD-NNN/` packet creation (`--url`, `--file`, `--text`, `--text-file`, stdin `-`), skeleton `wiki/sources/SRC-*.md` generation, host-path-free public capture logs, and `pending` queue inspection (`--source-id`, `--batch`).
- [x] 3.3 Implement `plugins/llm-wiki/scripts/lib/ensure.mjs` for safe canonical page creation (`entity`, `concept`, `synthesis`, `analysis`, `requirement`, custom `config.json` types), leading frontmatter merge preserving reserved fields, idempotent existing-page detection, and wikilink gate warnings.
- [x] 3.4 Implement `plugins/llm-wiki/scripts/lib/search.mjs` (whole-word Latin matching, stopwords, CJK bigrams/trigrams, field-weighted scoring, heading chunks, pseudo-relevance expansion, >50-page links-first threshold), `plugins/llm-wiki/scripts/lib/lint.mjs` (orphans, missing/ambiguous links, `⚠️ **Contradiction` detection, `.discoveries/gaps.json`, `--fix` >=2-citation concept stubs + `outputs/lint-YYYY-MM-DD.md`), and `plugins/llm-wiki/scripts/lib/status.mjs`.
- [x] 3.5 Implement `plugins/llm-wiki/scripts/wiki.mjs` dispatching `init`, `capture`, `pending`, `ensure`, `search`, `lint`, `status`, `rebuild`, and `log` with `--root`, `--json`, Markdown default formatting, and non-zero error exit codes.
- [x] 3.6 Write unit tests in `test/cli-operations.test.mjs` covering `init`, `capture` (file, text, stdin, HTML/JSON/XML, `pdftotext` PDF, binary magic-byte `unsupported` guard), `pending`, `ensure`, `search` (CJK + whole-word + >50 links-first), `lint` + `--fix` preserving contradictions, `status`, `log` override rejection, and `--json` CLI contracts, and verify all tests pass via `node --test test/cli-operations.test.mjs`.

## 4. On-Demand Style 1 Antigravity Skills & Documentation

- [x] 4.1 Create core schema skill `plugins/llm-wiki/skills/llm-wiki/SKILL.md` documenting the 4-layer architecture, OKF v0.2 / Obsidian conventions, Golden Rules, relative `../../scripts/wiki.mjs` usage, and explicit on-demand activation without ambient memory instructions.
- [x] 4.2 Create core operational slash skills (`wiki-init`, `wiki-capture`, `wiki-ingest`, `wiki-query`, `wiki-lint`, `wiki-status`) under `plugins/llm-wiki/skills/<name>/SKILL.md` with valid YAML frontmatter (`name`, `description`), direct URL/file capture-then-ingest plus optional `flash` subagent batch delegation in `wiki-ingest`, read-only citation-strict behavior in `wiki-query`, and human-review contradiction handling in `wiki-lint`.
- [x] 4.3 Create extended operational slash skills (`wiki-discover`, `wiki-digest`, `wiki-run`, `wiki-req`) under `plugins/llm-wiki/skills/<name>/SKILL.md` using built-in `search_web` in `wiki-discover`, manual-only `discover -> ingest -> lint` without scheduling in `wiki-run`, and clarify-capture-decompose in `wiki-req`.
- [x] 4.4 Write `plugins/llm-wiki/README.md` covering plugin usage, `/wiki-*` commands, workspace-local `.llm-wiki/` layout, and recommended Command Allowlist entry for `wiki.mjs`; verify all 11 `SKILL.md` files pass frontmatter/path checks and zero excluded skills (`wiki-retro`, `wiki-record`, `wiki-skills`, `wiki-trajectories`, `wiki-observe`, `wiki-watch`) exist.

## 5. Installer Script, Packaging Guard & Tests

- [x] 5.1 Implement `scripts/install-plugin.mjs` supporting symlink install (default) and `--copy` install from `plugins/llm-wiki/` to `~/.gemini/config/plugins/llm-wiki/`, `--force` conflict overwrite, `--uninstall`, and `--dest` override for isolated testing.
- [x] 5.2 Write `test/packaging-installer.test.mjs` validating `plugin.json` allowed fields, strict absence of `hooks.json`/`mcp_config.json`/`rules/`/`.claude-plugin`/`.pi`/`.omp`, and installer symlink idempotency, unrelated-destination protection, `--copy`, `--force`, and `--uninstall`; verify all tests pass via `node --test test/packaging-installer.test.mjs`.

## 6. End-to-End Integration & Discovery Verification

- [x] 6.1 Run the full test suite (`node --test test/*.test.mjs`) and execute an end-to-end CLI lifecycle smoke run (`init -> capture -> pending -> ensure -> rebuild -> search -> lint --fix -> status`) in a temporary workspace while confirming `$HOME/.llm-wiki/` is untouched.
- [x] 6.2 Run `node scripts/install-plugin.mjs` to install to `~/.gemini/config/plugins/llm-wiki/`, verify `plugins/llm-wiki` resolves cleanly, and verify via Antigravity plugin discovery (`GetAllPlugins`) that `llm-wiki` loads with all 11 skills, zero hooks, zero rules, and zero MCP servers.
