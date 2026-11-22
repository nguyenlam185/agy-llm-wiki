# LLM Wiki Plugin for Antigravity

On-demand, workspace-local knowledge curation following Andrej Karpathy's LLM Wiki pattern and Open Knowledge Format (OKF) v0.2, backed by a zero-dependency Node.js CLI (`scripts/wiki.mjs`).

## Design Principles

- **On-demand only**: Zero background MCP servers, zero lifecycle `hooks.json`, zero always-on `rules/AGENTS.md`, and zero automatic cross-turn memory/recall injection.
- **Workspace-local**: Operates strictly on `.llm-wiki/` inside your active project/workspace (never falls back to `~/.llm-wiki/` or `WIKI_HOME`).
- **Deterministic bookkeeping**: `scripts/wiki.mjs` handles source packets (`SRC-YYYY-MM-DD-NNN`), YAML frontmatter checks, atomic `meta/` & OKF v0.2 projections, lexical + CJK search, and health linting while the model handles reading, synthesis, and cross-referencing.

## Slash Commands (`/wiki-*`)

| Command | Purpose |
|---|---|
| `/wiki-init <topic> [--mode personal\|company]` | Scaffold a workspace `.llm-wiki/` vault |
| `/wiki-capture <url\|file\|text>` | Capture an immutable source packet + skeleton page |
| `/wiki-ingest [source_id\|url\|file]` | Synthesize pending packets into source/entity/concept pages |
| `/wiki-query <question>` | Search & synthesize a cited answer strictly from the wiki |
| `/wiki-lint [--fix]` | Check orphans, missing/ambiguous links, gaps, and contradictions |
| `/wiki-status` | Show page counts, pending queue, orphans, and tracked gaps |
| `/wiki-discover [--topic <topic>]` | Search the web for sources and capture raw packets |
| `/wiki-digest [--period daily\|weekly]` | Write an activity digest to `.llm-wiki/outputs/` |
| `/wiki-run` | Run a manual `discover -> ingest -> lint` maintenance pass |
| `/wiki-req <concept>` | Clarify, capture verbatim, and decompose atomic requirements |

The core operating manual is also available via the `llm-wiki` skill.

## Vault Layout

```text
.llm-wiki/
├── config.json
├── WIKI_SCHEMA.md
├── templates/pages/
├── raw/sources/SRC-YYYY-MM-DD-NNN/
├── wiki/{index.md,log.md,sources/,entities/,concepts/,syntheses/,analyses/,requirements/}
├── meta/{events.jsonl,registry.json,backlinks.json,index.md,log.md}
├── outputs/
└── .discoveries/gaps.json
```

Open `.llm-wiki/wiki/` directly in Obsidian for Graph View, Backlinks, and Dataview compatibility.

## Installation & Terminal Permissions

Install from the repository root to `~/.gemini/config/plugins/llm-wiki/`:

```bash
node scripts/install-plugin.mjs
```

Options: `--copy` (copy instead of symlink), `--force`, `--uninstall`.

**Optional Command Allowlist tip:** If your Antigravity Tool Execution Policy prompts on each CLI step, you can allowlist:

```text
node ~/.gemini/config/plugins/llm-wiki/scripts/wiki.mjs
```

## Attribution

Adapted from [`zosmaai/pi-llm-wiki`](https://github.com/zosmaai/pi-llm-wiki) (MIT License, Copyright (c) 2026 zosmaai) and Andrej Karpathy's LLM Wiki pattern.
