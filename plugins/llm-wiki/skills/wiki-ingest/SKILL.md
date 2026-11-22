---
name: wiki-ingest
description: Capture (if a new URL/file/text is given) and synthesize pending `.llm-wiki/raw/sources/SRC-*` packets into source, entity, and concept wiki pages. Invoke explicitly via `/wiki-ingest` or when asked to ingest sources into the workspace wiki.
---

# /wiki-ingest

Synthesize captured raw source packets into interlinked wiki pages, updating metadata projections at the end.

Let `<cli_path>` be `../../scripts/wiki.mjs` relative to this `SKILL.md` (typically `~/.gemini/config/plugins/llm-wiki/scripts/wiki.mjs`).

## Steps

1. **Direct input (optional):** If the user passed a URL, local file path, or inline text instead of a `SRC-*` ID, capture it first:
   ```bash
   node <cli_path> capture <source-flags> --json
   ```
   and target the returned `sourceId`.
2. **List pending packets:**
   ```bash
   node <cli_path> pending [--source-id <SRC-ID>] --batch 3 --json
   ```
   If `pending` is empty, report `"All captured sources are synthesized."` and stop.
3. **Synthesize each source in the batch:**
   - **Single source (inline):** Read `extractedPath` (`raw/sources/<SRC-ID>/extracted.md`) and `wiki/sources/<SRC-ID>.md`, then synthesize directly as below.
   - **Multiple sources (optional subagent batching):** When `pending.length > 1`, you may launch one subagent per source via `invoke_subagent` (`Model: "flash"`, `TypeName: "self"`, `Role: "Wiki Source Synthesizer"`) giving it the source's `extractedPath`, `sourcePagePath`, and existing page index (`meta/index.md`) and instructing it **not** to edit `raw/` or `meta/` and **not** to run `rebuild`. Once all subagents return, run `rebuild` once in Step 4.
   - **Per-source synthesis procedure:**
     a. Search existing pages with `node <cli_path> search "<key terms>" --json` to reuse existing entity/concept pages instead of duplicating.
     b. Rewrite `.llm-wiki/wiki/sources/<SRC-ID>.md` with `status: synthesized` in frontmatter, a 2–3 paragraph `## Summary`, `## Key Takeaways`, `## Entities Mentioned`, `## Concepts Mentioned`, `## Notable Quotes`, `## Connections`, and `## Source Packet`.
     c. For each key entity or concept, create missing pages safely with:
        ```bash
        node <cli_path> ensure --type <entity|concept> --title "<Title>" --body-file <tmp> --json
        ```
        or update existing pages via `edit_file` while preserving existing citations and updating `updated: YYYY-MM-DD`.
     d. Cross-link pages using folder-qualified links (`[[entities/slug]]`, `[Label](/concepts/slug.md)`), escaping pipes inside Markdown tables (`[[target\|alias]]`), and cite claims with `[[sources/<SRC-ID>]]`.
     e. Flag conflicting claims across sources using:
        ```markdown
        > ⚠️ **Contradiction:** [Claim A] vs. [Claim B]. See [[sources/...]].
        ```
4. **Rebuild deterministic metadata:**
   ```bash
   node <cli_path> rebuild --json
   ```
   Also log integration if desired (`node <cli_path> log --kind ingest --details '{"sources":["<SRC-ID>"]}'`).
5. Report: sources synthesized, pages created/updated, any contradictions flagged, and remaining pending count.

**Rules:**
- Never modify files in `.llm-wiki/raw/` or manually edit `.llm-wiki/meta/`.
- Never fabricate claims not present in the extracted source.
