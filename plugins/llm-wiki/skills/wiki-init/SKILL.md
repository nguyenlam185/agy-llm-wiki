---
name: wiki-init
description: Initialize a new workspace-local `.llm-wiki/` vault for Karpathy-pattern knowledge curation. Invoke explicitly via `/wiki-init <topic> [--mode personal|company]` or when asked to set up a project LLM Wiki.
---

# /wiki-init

Initialize an on-demand, workspace-local `.llm-wiki/` vault using the shared CLI at `../../scripts/wiki.mjs` (relative to this skill file).

## Steps

1. Extract `<topic>` and optional `--mode personal|company` from the user's request (default `mode` to `personal`). If no topic was provided, ask the user for the main wiki topic before creating anything.
2. Run from the active workspace root:
   ```bash
   node <cli_path> init --topic "<topic>" --mode <personal|company> --json
   ```
   where `<cli_path>` is `../../scripts/wiki.mjs` relative to this `SKILL.md` (typically `~/.gemini/config/plugins/llm-wiki/scripts/wiki.mjs`). Pass `--root <workspace>` if running from another directory.
3. Do NOT manually create `.llm-wiki/` folders or metadata files—the CLI creates `config.json`, `WIKI_SCHEMA.md`, `templates/`, `raw/sources/`, `wiki/`, `meta/`, `outputs/`, and `.discoveries/`.
4. Report the initialized vault path, mode, and format (`okf-0.2`), and suggest next steps:
   - `/wiki-capture <url|file>` to capture a source packet
   - `/wiki-ingest <url|file>` to capture and synthesize immediately
