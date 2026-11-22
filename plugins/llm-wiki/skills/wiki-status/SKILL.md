---
name: wiki-status
description: Show workspace `.llm-wiki/` health stats including page counts by type, pending raw sources, orphans, tracked gaps, and recent activity. Invoke explicitly via `/wiki-status`.
---

# /wiki-status

Display a concise operational overview of the workspace wiki.

Let `<cli_path>` be `../../scripts/wiki.mjs` relative to this `SKILL.md` (typically `~/.gemini/config/plugins/llm-wiki/scripts/wiki.mjs`).

## Steps

1. Run:
   ```bash
   node <cli_path> status --json
   ```
2. Present a concise summary:
   - Workspace root, topic, mode, and knowledge format (`okf-0.2`)
   - Total pages and breakdown by type (`source`, `entity`, `concept`, `synthesis`, `analysis`, `requirement`)
   - Pending raw source packets awaiting `/wiki-ingest`
   - Orphan count, tracked knowledge gaps, last update timestamp, and recent events
   - Any blocking diagnostics or warnings
3. Suggest `/wiki-ingest` if `pendingSources > 0`, or `/wiki-lint` if `orphans > 5`, `trackedGaps > 0`, or warnings exist.
