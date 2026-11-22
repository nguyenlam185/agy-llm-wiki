# Design

## Context

This change introduces an on-demand Antigravity plugin porting the core Karpathy LLM Wiki workflow from `refs/pi-llm-wiki` (v0.6.3) while omitting all ambient agent memory, personal-vault fallback, lifecycle hooks, MCP transport, and Pi/OMP/Claude host artifacts. See `proposal.md` for motivation and `specs/` for behavioral requirements.

Observed host constraints and environment state:
- Antigravity discovers global plugins under `~/.gemini/config/plugins/<dir>/` with `plugin.json` and `skills/<name>/SKILL.md` (currently containing only `drawio`, with no `llm-wiki` collision).
- Target runtime on this host provides Node.js `v24.19.0` (targeting Node `>= 22.0.0`), `/usr/bin/pdftotext`, `/usr/bin/python3`, and `/usr/bin/curl`, while `markitdown` / `uvx` is not installed by default.
- Antigravity loads skills via progressive disclosure: only `name` and `description` sit in context until a `/wiki-*` slash command or explicit wiki request triggers a skill.

## Goals / Non-Goals

**Goals:**
- Deliver all 11 Style 1 skills (`llm-wiki` + 10 `/wiki-*` commands) with zero ambient context cost outside wiki tasks.
- Keep all mechanical vault bookkeeping (source ID allocation, packet creation, frontmatter validation, link parsing, backlinks/registry/index/log projections, lexical/CJK search, orphan/gap lint) deterministic and fast via a zero-dependency Node ESM CLI.
- Maintain full `.llm-wiki/` OKF v0.2 and Obsidian compatibility with `refs/pi-llm-wiki` vaults, including unified templates that resolve upstream `raw/articles/` drift.
- Install cleanly to `~/.gemini/config/plugins/llm-wiki/` from the repository source under `plugins/llm-wiki/`.

**Non-Goals:**
- Supporting `~/.llm-wiki/` personal vaults, `WIKI_HOME`, or cross-project recall injection.
- Running a background MCP server, lifecycle `hooks.json`, `@tobilu/qmd` SQLite indexing, or embedding/vector API calls.
- Shipping `/wiki-retro`, `wiki_observe`, trajectory working-memory, `wiki_watch` cron generation, or TUI configuration screens.

## Decisions

### 1. Skills-Only Antigravity Plugin + Shared CLI (Option B) over Pure Prompts (Option A) or MCP (Option C)
- **Choice**: Package `plugins/llm-wiki/` as a skills-only plugin (`plugin.json`, `skills/`, `templates/`, `scripts/`) backed by a single CLI invoked on demand via `run_command`.
- **Alternatives considered**:
  - *Option A (Pure markdown skills without scripts)*: Lowest setup, but forces the LLM to manually edit `INDEX.md` / `LOG.md` and `grep` for orphans, causing token waste and metadata drift past ~30 pages.
  - *Option C (Plugin + stdio MCP server + `PreToolUse` hooks)*: Adds an idle background process, permanently injects MCP tool schemas into non-wiki sessions, and adds hook latency on every file write.
- **Rationale**: Option B gives deterministic bookkeeping matching `refs/pi-llm-wiki` with zero idle processes, zero global tool schema bloat, and zero hook execution outside explicit wiki workflows.

### 2. Zero-Dependency Node >= 22 ESM CLI vs. Bundling Upstream npm Packages
- **Choice**: Implement `plugins/llm-wiki/scripts/wiki.mjs` and modular libraries under `plugins/llm-wiki/scripts/lib/` using only Node.js built-in modules (`node:fs`, `node:path`, `node:crypto`, `node:child_process`, `node:os`, `node:test`, global `fetch`), avoiding a TypeScript build step or `node_modules` tree.
- **Alternatives considered**: Bundling `@earendil-works/*`, `yaml`, `mdast-util-from-markdown`, and `node-html-markdown` from npm.
- **Rationale**: A pure ESM codebase runs directly out of `~/.gemini/config/plugins/llm-wiki/` (whether symlinked or `--copy` installed) with no `npm install` or build step and trivial portability across machines.
- **Module decomposition** (`plugins/llm-wiki/scripts/lib/`):
  - `paths.mjs`: strict workspace-local vault discovery, `.llm-wiki/` path layout, slugify (including full-width folding, CJK preservation, Windows reserved device guards, `index`/`log` collision guards), and `realpath`-safe path containment checks.
  - `frontmatter.mjs`: strict OKF YAML frontmatter parser/serializer supporting scalars, sequences, nested maps, inline arrays/objects, 128 KB / depth-32 limits, and rejecting YAML aliases, custom tags, duplicate keys, and multi-document blocks.
  - `links.mjs`: code-block/inline-code masking (` ``` `, `~~~`, indented/inline backticks) followed by dual extraction of `[[target]]` / `[[target\|alias]]` wikilinks and `[label](path.md)` Markdown links, plus normalized target resolution and wikilink validation.
  - `vault.mjs`: `config.json` validation, `okf-0.2` / `legacy` detection, directory discovery excluding reserved `index.md` / `log.md`, and collision checks.
  - `metadata.mjs`: fail-closed `rebuild` computing `registry.json`, `backlinks.json`, `meta/index.md`, `meta/log.md`, OKF `wiki/index.md` (and subdirectory indexes with stale-index pruning), `wiki/log.md`, and append-only `meta/events.jsonl` writes via temp-file + `renameSync`.
  - `extractors.mjs`: magic-byte binary detector; text/JSON/XML/HTML-to-Markdown normalizers; URL `fetch` with timeout/content-type inspection; PDF/DOCX extraction via `execFile` (no shell interpolation) probing `markitdown`/`uvx` first and falling back to `pdftotext` (for PDFs) or `python3` `zipfile` XML extraction (for DOCX).
  - `capture.mjs`: `SRC-YYYY-MM-DD-NNN` packet creation (`manifest.json`, `original/`, `extracted.md`, `attachments/`), skeleton `wiki/sources/SRC-*.md` generation, and `pending` queue inspection.
  - `ensure.mjs`: safe canonical page creation (`entity`, `concept`, `synthesis`, `analysis`, `requirement`, plus `config.json` `customTypes`), frontmatter merge preserving reserved fields (`type`, `title`, `created`, `updated`, `sources`), and wikilink diagnostics.
  - `search.mjs`: whole-word Latin matching + English stopword list + overlapping CJK bigram/trigram tokenization, field-weighted scoring, heading-chunk previews, pseudo-relevance expansion, and links-first cutoff (`> 50` pages by default).
  - `lint.mjs`: orphan/missing/ambiguous link detection, `⚠️ **Contradiction` detection, `.discoveries/gaps.json` persistence, and `--fix` concept-stub creation for gaps cited by >= 2 pages + `outputs/lint-YYYY-MM-DD.md`.
  - `status.mjs`: aggregated vault health metrics + recent event summaries.

### 3. Strict Workspace-Local Vault Resolution (No Personal Vault Fallback)
- **Choice**: `resolveVaultRoot(cwd, explicitRoot)` resolves `--root` directly when provided; otherwise it walks upward from `cwd` checking for `.llm-wiki/config.json` and stops strictly **before** `os.homedir()` (ignoring `$HOME/.llm-wiki/` and `WIKI_HOME` completely). `init` targets `explicitRoot || cwd`.
- **Rationale**: Prevents silent cross-project contamination and honors the explicit non-goal of dropping `~/.llm-wiki/`.

### 4. Unified OKF v0.2 + Obsidian Templates
- **Choice**: Fix the template drift present in `refs/pi-llm-wiki/skills/llm-wiki/templates/` by updating all templates under `plugins/llm-wiki/templates/` (`WIKI_SCHEMA.md` and `pages/{source,entity,concept,synthesis,analysis,requirement}.md`) to use `raw/sources/SRC-YYYY-MM-DD-NNN/` citations and folder-qualified links. Both `[[folder/page]]` and `[label](/folder/page.md)` remain first-class across `links.mjs` and `rebuild`.
- **Rationale**: Keeps new pages valid under OKF v0.2 and immediately browsable in Obsidian Graph View and Dataview without manual path repair.

### 5. Skill Invocation, Script Path Resolution, and Optional Subagent Ingest
- **Choice**: Each `skills/<name>/SKILL.md` defines `name` + explicit on-demand `description` frontmatter for Style 1 `/wiki-*` invocation and invokes `node ~/.gemini/config/plugins/llm-wiki/scripts/wiki.mjs` (resolved via `../../scripts/wiki.mjs` relative to the loaded `SKILL.md` path, falling back to `~/.gemini/config/plugins/llm-wiki/scripts/wiki.mjs` or `plugins/llm-wiki/scripts/wiki.mjs` in-repo).
- **Subagent batching**: For `/wiki-ingest`, single sources synthesize inline; when processing multi-source batches (`pending --batch N`), the skill optionally delegates per-source reading and page drafting to `invoke_subagent` (`Model: "flash"`) followed by a single deterministic `wiki.mjs rebuild` in the parent turn.
- **Rationale**: Eliminates `refs/pi-llm-wiki`'s external API key requirement (`mcp/model-lane.ts`) by using Antigravity's native model execution while keeping batch ingestion clean.

### 6. Zero Hooks Immutability Trade-Off
- **Choice**: Omit `hooks.json` completely. Rely on skill Golden Rules (`raw/` and `meta/` are CLI-managed, never hand-edited) and CLI-level fail-closed validation (`rebuild` / `lint` / `ensure`).
- **Rationale**: Matches the user's explicit zero-hooks decision so unrelated sessions pay zero hook execution latency or permission friction.

### 7. Authoring & Installation Layout (`scripts/install-plugin.mjs`)
- **Choice**: Author the plugin in-repo at `plugins/llm-wiki/` and install to `~/.gemini/config/plugins/llm-wiki/` via `scripts/install-plugin.mjs` (default symlink for live repo iteration, `--copy` for standalone copy, `--force` to replace conflicting entries, `--uninstall` to remove cleanly).
- **Rationale**: Keeps the workspace as the versioned source of truth while enabling immediate global Antigravity discovery.

## Risks / Trade-offs

- **Terminal approval prompts on `run_command` (`request-review` / `strict` policy)** → Funnel all CLI calls through one script path (`plugins/llm-wiki/scripts/wiki.mjs` / `~/.gemini/config/plugins/llm-wiki/scripts/wiki.mjs`) and document a single Command Allowlist rule in `plugins/llm-wiki/README.md`.
- **Zero-dependency YAML & HTML-to-Markdown edge cases** → Restrict frontmatter generation to canonical OKF YAML, enforce explicit size/depth/syntax diagnostics on malformed user edits, and write targeted `node --test` unit tests covering escaped quotes, block scalars, code-fenced links, CJK tokens, and malformed HTML.
- **JavaScript-rendered URLs failing Node `fetch`** → Document fallback in `/wiki-capture` and `/wiki-ingest` skills so users or the browser subagent can capture extracted text or saved HTML via `--text` / `--file`.
- **No `PreToolUse` hard guard against manual `raw/` or `meta/` edits** → Keep strong warnings in `llm-wiki` skill instructions and make `wiki.mjs rebuild` deterministically overwrite derived `meta/*` projections from `wiki/` + `events.jsonl`.
