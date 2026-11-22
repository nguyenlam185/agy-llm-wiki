---
name: wiki-capture
description: Capture a URL, local file (PDF/DOCX/MD/HTML/JSON/XML/TXT), or pasted text into an immutable `.llm-wiki/raw/sources/SRC-*` packet. Invoke explicitly via `/wiki-capture` or when asked to save a raw source into the wiki.
---

# /wiki-capture

Capture a source into an immutable packet and skeleton source page without running synthesis yet.

## Steps

1. Identify the input from the user's arguments:
   - HTTP(S) URL → `--url "<url>"`
   - Local file path → `--file "<path>"`
   - Inline/pasted text → `--text "<content>"` (or `--stdin` / `--text-file` for large text)
   - Optional `--title "<title>"`
   If no input was provided, ask the user for a URL, file path, or text snippet.
2. Run the CLI (`../../scripts/wiki.mjs` relative to this `SKILL.md`, typically `~/.gemini/config/plugins/llm-wiki/scripts/wiki.mjs`):
   ```bash
   node <cli_path> capture <source-flags> --json
   ```
3. If a URL points to a JavaScript-rendered SPA and extracted text is empty or incomplete, let the user know they can save the page or paste its content and re-run with `--file` or `--text` (or fetch via browser if requested).
4. Report the created `sourceId` (`SRC-YYYY-MM-DD-NNN`), extraction status, packet directory, and skeleton page path (`wiki/sources/SRC-*.md`). Remind the user they can run `/wiki-ingest` whenever ready to synthesize.

**Rules:**
- Never create or edit files inside `.llm-wiki/raw/` directly.
- Do not modify canonical `entities/` or `concepts/` pages during `/wiki-capture`.
