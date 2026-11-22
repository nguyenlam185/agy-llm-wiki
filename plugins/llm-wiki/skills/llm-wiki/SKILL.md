---
name: llm-wiki
description: Core schema, 4-layer workspace architecture, and operating conventions for an on-demand Karpathy-pattern LLM Wiki in `.llm-wiki/`. Activate only when explicitly invoked or when executing `/wiki-*` workflows.
---

# LLM Wiki Operating Manual

You are a disciplined maintainer of an on-demand, workspace-local Markdown knowledge base stored in `.llm-wiki/` following Andrej Karpathy's LLM Wiki pattern and Open Knowledge Format (OKF) v0.2.

All mechanical operations are handled by the shared CLI located two directories above this skill (`../../scripts/wiki.mjs`, typically `~/.gemini/config/plugins/llm-wiki/scripts/wiki.mjs`).

## Workspace-Local Scope

- Every command operates **only** on the active workspace's `.llm-wiki/` directory (walking upward from `cwd` and stopping before `$HOME`, or targeting `--root <dir>`).
- There is no global `~/.llm-wiki/` personal vault and no automatic background recall across sessions.

## Architecture (4 Layers)

```text
<workspace>/
└── .llm-wiki/
    ├── config.json                  # Vault metadata & format (okf-0.2)
    ├── WIKI_SCHEMA.md               # Workspace schema & style rules
    ├── templates/pages/             # Canonical page templates
    ├── raw/
    │   ├── assets/                  # Supporting media
    │   └── sources/SRC-YYYY-MM-DD-NNN/
    │       ├── manifest.json        # Capture metadata
    │       ├── original/            # Preserved source artifact
    │       ├── extracted.md         # Normalized Markdown text
    │       └── attachments/
    ├── wiki/                        # Obsidian-compatible editable pages
    │   ├── index.md                 # Generated OKF v0.2 root index (CLI-owned)
    │   ├── log.md                   # Generated OKF v0.2 log snapshot (CLI-owned)
    │   ├── sources/                 # One page per captured source (`SRC-*.md`)
    │   ├── entities/                # People, orgs, tools, products, projects
    │   ├── concepts/                # Ideas, patterns, frameworks
    │   ├── syntheses/               # Cross-source theses and tensions
    │   ├── analyses/                # Durable filed query answers
    │   └── requirements/            # Atomic traceable requirements
    ├── meta/
    │   ├── events.jsonl             # Authoritative append-only event log
    │   ├── registry.json            # Generated page catalog
    │   ├── backlinks.json           # Generated inbound link map
    │   ├── index.md                 # Generated type-grouped index
    │   └── log.md                   # Generated activity log
    ├── outputs/                     # Digests, lint reports, and run summaries
    └── .discoveries/                # Unresolved link gaps (`gaps.json`)
```

## Golden Rules

1. **RAW IS IMMUTABLE.** Never create, edit, or delete files inside `.llm-wiki/raw/`. Always use `wiki.mjs capture`.
2. **META AND GENERATED INDEXES ARE CLI-OWNED.** Never hand-edit `.llm-wiki/meta/**`, `.llm-wiki/wiki/index.md`, or `.llm-wiki/wiki/log.md`. Run `wiki.mjs rebuild` or `wiki.mjs log`.
3. **YOU OWN KNOWLEDGE PAGES.** Create and edit content pages in `.llm-wiki/wiki/{sources,entities,concepts,syntheses,analyses,requirements}/`.
4. **ONE FILE PER THING.** Use `kebab-case.md` filenames (`wiki.mjs ensure` creates slugs safely).
5. **CROSS-REFERENCE WITH FOLDER-QUALIFIED LINKS.** Use `[Label](/folder/page.md)` or `[[folder/page]]` (with `[[target\|alias]]` inside Markdown table cells).
6. **CITE SOURCES.** Every factual claim cites its source packet (`[[sources/SRC-YYYY-MM-DD-NNN]]` or `[SRC-YYYY-MM-DD-NNN](/sources/SRC-YYYY-MM-DD-NNN.md)`).
7. **FLAG CONTRADICTIONS.** Never silently pick one side when sources disagree; preserve both claims under `> ⚠️ **Contradiction:**`.

## CLI Command Reference

Run with `node <plugin_root>/scripts/wiki.mjs <subcommand>` (`--root <dir>` optional, `--json` for structured output):

- `init --topic <topic> [--mode personal|company]` — Scaffold `.llm-wiki/`
- `capture (--url <u> | --file <p> | --text <t> | --text-file <p> | --stdin) [--title <t>]` — Create immutable source packet + skeleton page
- `pending [--source-id <id>] [--batch <n>]` — List uningested `SRC-*` packets
- `ensure --type <t> --title <t> [--body <md> | --body-file <p> | --stdin]` — Safely create a canonical page
- `search <query> [--type <t>] [--max <n>] [--links-only] [--inline]` — Lexical + CJK search over the vault
- `lint [--fix]` — Scan orphans, missing/ambiguous links, gaps, and contradictions
- `status` — Show page counts, pending sources, orphans, and tracked gaps
- `rebuild` — Atomically regenerate `meta/` and OKF `wiki/index.md` / `wiki/log.md`
- `log --kind <kind> [--details <json>]` — Append structured event to `meta/events.jsonl`

Page templates live in `../../templates/pages/` (and are copied to `.llm-wiki/templates/pages/` on `init`).

## On-Demand Slash Workflows

- `/wiki-init` — Initialize a workspace vault
- `/wiki-capture` — Capture a URL, local file, or pasted text without synthesizing yet
- `/wiki-ingest` — Process pending source packets (or capture + ingest a new input)
- `/wiki-query` — Search and answer strictly from wiki pages with citations
- `/wiki-lint` — Audit vault health and optionally stub repeated missing concepts
- `/wiki-status` — Inspect vault statistics and ingest queue
- `/wiki-discover` — Search the web to capture new sources based on topics and gaps
- `/wiki-digest` — Write a daily or weekly activity digest to `outputs/`
- `/wiki-run` — Run a manual `discover -> ingest -> lint` maintenance cycle
- `/wiki-req` — Clarify a concept, capture verbatim, and decompose atomic requirements
