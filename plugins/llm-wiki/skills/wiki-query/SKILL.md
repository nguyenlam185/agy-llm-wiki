---
name: wiki-query
description: Query the workspace `.llm-wiki/` knowledge base and synthesize a cited answer strictly from wiki pages. Invoke explicitly via `/wiki-query <question>` or when asked to answer a question from the project wiki.
---

# /wiki-query

Search the workspace wiki, read full matching pages, and synthesize a grounded answer with citations.

Let `<cli_path>` be `../../scripts/wiki.mjs` relative to this `SKILL.md` (typically `~/.gemini/config/plugins/llm-wiki/scripts/wiki.mjs`).

## Steps

1. **Search the wiki:**
   ```bash
   node <cli_path> search "<question or key terms>" --max 8 --json
   ```
   Also check `.llm-wiki/meta/index.md` or run a follow-up `search` with alternate keywords if initial hits are sparse.
2. **Expand full pages on demand:** Read the full Markdown content of relevant matched `path` files using `read_file`. Never rely solely on search snippets—especially in `linksOnly: true` mode (> 50 pages).
3. **Synthesize strictly from wiki content:**
   - Answer **only** from what the read wiki pages state, citing pages inline (`[[concepts/slug]]`, `[Label](/entities/slug.md)`, and `[[sources/SRC-...]]`).
   - Include **Tensions / caveats** if any read page marks a `⚠️ **Contradiction**` or uncertainty.
   - If the wiki lacks information to answer part or all of the question, state that gap clearly and suggest what sources to capture next—do not backfill from general model knowledge as if it came from the wiki.
4. **Read-only by default:** Only file a durable page (`node <cli_path> ensure --type analysis|synthesis --title "<Title>" --body-file <tmp> --json` followed by `node <cli_path> rebuild`) if the user explicitly asks to save/file the answer or asks for a new synthesis page.
5. **Log the query event:**
   ```bash
   node <cli_path> log --kind query --details '{"question":"<escaped question>"}' --json
   ```
