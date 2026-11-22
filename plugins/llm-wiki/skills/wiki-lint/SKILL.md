---
name: wiki-lint
description: Audit workspace `.llm-wiki/` health for orphan pages, broken/ambiguous links, knowledge gaps, and flagged contradictions. Invoke explicitly via `/wiki-lint [--fix]`.
---

# /wiki-lint

Run deterministic health checks across the workspace wiki and present actionable findings.

Let `<cli_path>` be `../../scripts/wiki.mjs` relative to this `SKILL.md` (typically `~/.gemini/config/plugins/llm-wiki/scripts/wiki.mjs`).

## Steps

1. Check whether the user requested auto-fix (`--fix` in arguments).
2. Execute:
   ```bash
   node <cli_path> lint [--fix] --json
   ```
3. Present a structured summary covering:
   - Total pages, orphans (zero inbound links), missing pages, ambiguous links, and tracked gaps (`.llm-wiki/.discoveries/gaps.json`).
   - Any stub concept pages auto-created (for unresolved topics cited by >= 2 pages when `--fix` was passed) and the saved report path in `.llm-wiki/outputs/lint-*.md`.
4. **Human review for contradictions:** List every page containing `⚠️ **Contradiction` and highlight it for human judgment—never auto-resolve or delete contradictions.
5. If notable knowledge gaps or orphans remain, suggest concrete pages to link or `/wiki-discover` topics to capture.
