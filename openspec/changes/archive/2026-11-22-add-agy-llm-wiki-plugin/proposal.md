# Proposal

## Why

Karpathy's LLM Wiki pattern solves the ephemerality of one-shot RAG by maintaining a durable, interlinked, Obsidian-compatible markdown knowledge base (`raw/` → `wiki/` → `outputs/`). However, `refs/pi-llm-wiki` couples that core workflow to Pi/OMP runtime APIs, always-on personal memory (`~/.llm-wiki/`), lifecycle auto-recall/observe hooks, session trajectory tracking, and Claude-specific plugin scaffolding—none of which belong in an explicit, workspace-scoped Antigravity toolset.

## What Changes

- Author a skills-only Antigravity plugin under `plugins/llm-wiki/` installable to `~/.gemini/config/plugins/llm-wiki/` with zero runtime hooks, zero always-on rules, and zero background MCP servers.
- Implement a zero-dependency Node.js (>= 22) ESM CLI (`plugins/llm-wiki/scripts/wiki.mjs`) providing deterministic, workspace-local `.llm-wiki/` vault operations (`init`, `capture`, `pending`, `ensure`, `search`, `lint`, `status`, `rebuild`, `log`) compatible with Open Knowledge Format (OKF) v0.2 and Obsidian.
- Port the on-demand Style 1 `/wiki-*` skill set (11 skills: `llm-wiki`, `wiki-init`, `wiki-capture`, `wiki-ingest`, `wiki-query`, `wiki-lint`, `wiki-status`, `wiki-discover`, `wiki-digest`, `wiki-run`, `wiki-req`) along with unified OKF v0.2 page templates.
- Exclude all always-on agent memory and foreign-host features: `/wiki-retro`, `wiki_observe`, trajectory working-memory (`/wiki-record`, `/wiki-skills`, `/wiki-trajectories`), personal vault (`~/.llm-wiki/`) fallback, lifecycle hooks (`hooks.json`), MCP servers (`mcp_config.json`), `.claude-plugin/`, `.pi`/`.omp` TUI/settings integration, `@tobilu/qmd` / vector embeddings, and `wiki_watch` cron scheduling.
- Provide an idempotent installer (`scripts/install-plugin.mjs`) to symlink (default) or copy `plugins/llm-wiki/` into `~/.gemini/config/plugins/llm-wiki/`, plus automated Node test coverage (`test/`).

## Capabilities

### New Capabilities
- `wiki-cli-engine`: Workspace-local `.llm-wiki/` vault resolution, initialization, immutable source packet capture/extraction, deterministic OKF v0.2 metadata & index projections, lexical/CJK search, health linting, status reporting, and structured event logging via a zero-dependency Node ESM CLI.
- `wiki-skill-workflows`: The 11 on-demand Style 1 Antigravity skills (`/wiki-*` and core `llm-wiki`) plus unified page/schema templates implementing Karpathy's manual Ingest, Query, Lint, Discover, Digest, Run, Capture, and Requirements decomposition workflows without automated memory behaviors.
- `agy-plugin-packaging`: Antigravity plugin manifest (`plugin.json`), strict non-ambient bundle structure (omitting hooks, MCP configs, rules, and Claude/Pi files), and an idempotent local installer targeting `~/.gemini/config/plugins/llm-wiki/`.

### Modified Capabilities
<!-- None: greenfield plugin and CLI implementation. -->

## Impact

- **New workspace files**: `plugins/llm-wiki/` (manifest, templates, 11 skills, CLI scripts), `scripts/install-plugin.mjs`, and `test/` (`node --test` suites).
- **Local user environment (on install)**: Symlink or directory copy at `~/.gemini/config/plugins/llm-wiki/` discovered globally by Antigravity, while operating strictly on each active workspace's `.llm-wiki/`.
- **Reference tree (`refs/`)**: Untouched; read-only reference only.
- **External dependencies**: Zero npm runtime dependencies; leverages built-in Node.js >= 22 (`fetch`, `node:fs`, `node:test`) and optional system tools (`pdftotext`, `markitdown`, `python3`) for document extraction.
