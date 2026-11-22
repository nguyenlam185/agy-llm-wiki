---
name: wiki-digest
description: Generate a daily or weekly activity digest for the workspace `.llm-wiki/` vault and save it to `outputs/`. Invoke explicitly via `/wiki-digest [--period daily|weekly]`.
---

# /wiki-digest

Summarize recent workspace wiki activity into a dated Markdown report in `.llm-wiki/outputs/`.

Let `<cli_path>` be `../../scripts/wiki.mjs` relative to this `SKILL.md` (typically `~/.gemini/config/plugins/llm-wiki/scripts/wiki.mjs`).

## Steps

1. Parse `--period` (`daily` default, or `weekly` for the past 7 days).
2. Gather state:
   - Run `node <cli_path> status --json`
   - Read `.llm-wiki/meta/log.md` and `.llm-wiki/.discoveries/gaps.json` (if present) via `read_file`
3. Draft a concise digest covering:
   - New sources captured during the period
   - Pages created or updated (by type)
   - Key synthesis connections or flagged contradictions
   - Outstanding knowledge gaps and pending ingest queue
   - Overall vault health trend
4. Save the digest to `.llm-wiki/outputs/digest-YYYY-MM-DD.md` using `write_file`.
5. Log the digest event:
   ```bash
   node <cli_path> log --kind digest --details '{"period":"<daily|weekly>"}' --json
   ```
6. Present the saved path and concise summary to the user.
