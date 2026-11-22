# agy-llm-wiki

On-demand, workspace-local knowledge curation plugin for **Google Antigravity**, implementing Andrej Karpathy's LLM Wiki pattern and Open Knowledge Format (OKF) v0.2 on top of a zero-dependency Node.js (`>= 22`) CLI (`plugins/llm-wiki/scripts/wiki.mjs`).

## Design Principles

- **On-demand only**: Zero background MCP servers, zero lifecycle `hooks.json`, zero always-on `rules/` or `AGENTS.md` injection, and zero automatic cross-turn memory recall.
- **Workspace-local**: Operates strictly on `.llm-wiki/` inside the active project workspace (never falls back to `~/.llm-wiki/` or `WIKI_HOME`).
- **Deterministic bookkeeping**: `scripts/wiki.mjs` manages immutable source packets (`SRC-YYYY-MM-DD-NNN`), YAML frontmatter checks, atomic `meta/` & OKF v0.2 projections, lexical + CJK search, and health linting while Antigravity handles reading, synthesis, and cross-referencing.

## Quick Install

Requires **Node.js >= 22**.

```bash
git clone https://github.com/nguyenlam185/agy-llm-wiki.git
cd agy-llm-wiki
node scripts/install-plugin.mjs
```

By default, `install-plugin.mjs` symlinks `plugins/llm-wiki/` to `~/.gemini/config/plugins/llm-wiki/`.

Installer options:
- `--copy`: Install a standalone directory copy instead of a symlink.
- `--force`: Replace an existing destination at the target path.
- `--uninstall`: Remove the installed plugin cleanly without modifying the repo.
- `--source <dir>` / `--dest <dir>`: Override default source or destination paths.

**Optional Command Allowlist tip:** If your Antigravity Tool Execution Policy prompts on each CLI invocation, you can allowlist:

```text
node ~/.gemini/config/plugins/llm-wiki/scripts/wiki.mjs
```

## Slash Commands (`/wiki-*`)

| Command | Purpose |
|---|---|
| `/wiki-init <topic> [--mode personal\|company]` | Scaffold a workspace `.llm-wiki/` vault |
| `/wiki-capture <url\|file\|text>` | Capture an immutable source packet + skeleton source page |
| `/wiki-ingest [source_id\|url\|file]` | Synthesize pending packets into source, entity, and concept pages |
| `/wiki-query <question>` | Search & synthesize a cited answer grounded strictly in the wiki |
| `/wiki-lint [--fix]` | Check orphans, missing/ambiguous links, gaps, and contradictions |
| `/wiki-status` | Show page counts, pending queue, orphans, and tracked gaps |
| `/wiki-discover [--topic <topic>]` | Search the web for sources and capture raw packets |
| `/wiki-digest [--period daily\|weekly]` | Write an activity digest to `.llm-wiki/outputs/` |
| `/wiki-run` | Run a manual `discover -> ingest -> lint` maintenance cycle |
| `/wiki-req <concept>` | Clarify, capture verbatim, and decompose atomic requirements |

The core vault schema and conventions are also available on demand via the `llm-wiki` skill.

## Repository Layout

```text
.
├── LICENSE                     # MIT License (Copyright (c) 2026 zosmaai)
├── README.md
├── openspec/                   # Specifications and archived design/proposal docs
├── plugins/llm-wiki/           # Antigravity plugin bundle (manifest, 11 skills, CLI, templates)
├── scripts/install-plugin.mjs  # Idempotent global plugin installer
└── test/                       # Node built-in test suite
```

## Vault Layout (`.llm-wiki/`)

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

## Testing

Run the Node built-in test suite (zero npm dependencies required):

```bash
node --test test/*.test.mjs
```

Validate OpenSpec specifications (if `openspec` CLI is installed):

```bash
openspec validate --specs --strict
```

## License & Attribution

Licensed under the [MIT License](LICENSE).

Adapted from [`zosmaai/pi-llm-wiki`](https://github.com/zosmaai/pi-llm-wiki) (MIT License, Copyright (c) 2026 zosmaai) and Andrej Karpathy's LLM Wiki pattern.
