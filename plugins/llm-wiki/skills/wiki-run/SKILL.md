---
name: wiki-run
description: Run a manual on-demand maintenance cycle (discover -> ingest -> lint -> summary report) for the workspace `.llm-wiki/` vault. Invoke explicitly via `/wiki-run`.
---

# /wiki-run

Execute the full manual Karpathy LLM Wiki maintenance loop on demand, with no background scheduling or cron installation.

Let `<cli_path>` be `../../scripts/wiki.mjs` relative to this `SKILL.md` (typically `~/.gemini/config/plugins/llm-wiki/scripts/wiki.mjs`).

## Steps

1. **Discover:** Follow `/wiki-discover` (check `status`, `.llm-wiki/.discoveries/gaps.json`, run `search_web`, and capture 3–8 high-signal sources via `wiki.mjs capture --url`).
2. **Ingest:** Follow `/wiki-ingest` (`pending --batch 5`, read `extracted.md`, update `wiki/sources/SRC-*.md` and `entities/` / `concepts/`, flag contradictions, run `node <cli_path> rebuild --json`).
3. **Lint:** Run `node <cli_path> lint --json` (or `--fix` only if requested by the user).
4. **Report:** Save a cycle report to `.llm-wiki/outputs/run-YYYY-MM-DD.md` summarizing sources captured, pages created/updated, lint findings, and remaining gaps, then run:
   ```bash
   node <cli_path> log --kind run --json
   ```
5. Present the final summary and saved report path to the user.

**Scope note:** This command runs strictly on demand when invoked. Do not configure cron jobs or background schedules.
