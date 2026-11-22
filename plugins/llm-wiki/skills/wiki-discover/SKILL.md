---
name: wiki-discover
description: Search the web for high-signal sources matching the workspace `.llm-wiki/` topic or tracked knowledge gaps and capture them as raw packets. Invoke explicitly via `/wiki-discover [--topic <topic>]`.
---

# /wiki-discover

Discover new web sources relevant to the workspace wiki and capture them into `.llm-wiki/raw/sources/`.

Let `<cli_path>` be `../../scripts/wiki.mjs` relative to this `SKILL.md` (typically `~/.gemini/config/plugins/llm-wiki/scripts/wiki.mjs`).

## Steps

1. Inspect current wiki state and gaps:
   - Run `node <cli_path> status --json` to read the wiki's configured `topic` and `mode`.
   - Read `.llm-wiki/.discoveries/gaps.json` (if present) using `read_file` to identify high-priority missing topics.
   - Run `node <cli_path> search "<focus topic>" --max 10 --json` to see what is already covered.
2. Search the web using Antigravity's `search_web` tool:
   - Focus on `--topic` if provided; otherwise combine the wiki's main topic with open gaps and recent developments.
   - Prefer primary documentation, papers, engineering postmortems, and in-depth technical articles; skip ads, SEO listicles, and already-captured URLs.
3. Capture 5–10 promising URLs sequentially:
   ```bash
   node <cli_path> capture --url "<url>" --json
   ```
   (Skip any URL that fails capture and report it briefly.)
4. Report the list of captured `SRC-*` IDs and titles, and suggest running `/wiki-ingest` to synthesize them into knowledge pages.

**Rules:**
- Never save raw articles into `.llm-wiki/raw/` manually—always use `wiki.mjs capture`.
- Do not synthesize canonical pages during `/wiki-discover`; keep discovery and ingestion separate.
