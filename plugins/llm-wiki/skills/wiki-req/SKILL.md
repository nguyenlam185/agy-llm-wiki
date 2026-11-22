---
name: wiki-req
description: Clarify a concept interactively, capture it verbatim into `raw/sources/`, and decompose it into atomic traceable requirement pages in `.llm-wiki/wiki/requirements/`. Invoke explicitly via `/wiki-req <concept>`.
---

# /wiki-req

Transform an informal feature or system concept into immutable source provenance plus atomic, testable wiki requirements.

Let `<cli_path>` be `../../scripts/wiki.mjs` relative to this `SKILL.md` (typically `~/.gemini/config/plugins/llm-wiki/scripts/wiki.mjs`).

## Steps

1. **Clarify the concept:**
   - Unpack ambiguous terms, actors, edge cases, fallback behavior, and scope boundaries.
   - Ask targeted clarifying questions before capturing if material unknowns remain.
2. **Capture the clarified concept verbatim:**
   - Pipe or pass the agreed Markdown summary to `capture`:
     ```bash
     node <cli_path> capture --text "<clarified markdown>" --title "<concept title>" --json
     ```
   - Preserve the returned `sourceId` (`SRC-YYYY-MM-DD-NNN`). Never alter `.llm-wiki/raw/`.
3. **Decompose into atomic requirements:**
   - Split the clarified concept into the smallest independently verifiable behaviors.
   - For each requirement, create a page under `.llm-wiki/wiki/requirements/` using `ensure` (`../../templates/pages/requirement.md` format):
     ```bash
     node <cli_path> ensure --type requirement --title "<Requirement Title>" --body-file <tmp> --json
     ```
     Include frontmatter (`status: draft`, `priority: p0|p1|p2|p3`, `source_id: <SRC-ID>`, `depends_on: [...]`), `## Description`, `## Acceptance Criteria` checkboxes, and folder-qualified links (`[[sources/<SRC-ID>]]`, `[[concepts/...]]`, `[[entities/...]]`).
4. **Cross-link and rebuild:**
   - Add bidirectional links on related entity/concept pages where helpful (escape pipes inside Markdown tables as `[[target\|alias]]`).
   - Run `node <cli_path> rebuild --json`.
5. Report the source packet ID, created requirement pages, and priorities.

**Rules:**
- One atomic verifiable behavior per requirement page.
- Always capture the clarified concept via `wiki.mjs capture` before writing requirement pages.
- Valid statuses: `draft` → `clarified` → `active` → `implemented` → `deferred` → `rejected`.
- Valid priorities: `p0`, `p1`, `p2`, `p3`.
