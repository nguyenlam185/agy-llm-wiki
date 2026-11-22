# Spec Delta

## Purpose

Defines the 11 on-demand Style 1 Antigravity skills (`/wiki-*` plus `llm-wiki`) and unified OKF v0.2 page templates that drive Karpathy's wiki workflows without automated agent memory.

## ADDED Requirements

### Requirement: Style 1 skill inventory and explicit on-demand activation
The plugin SHALL provide 11 skills under `skills/`: `llm-wiki`, `wiki-init`, `wiki-capture`, `wiki-ingest`, `wiki-query`, `wiki-lint`, `wiki-status`, `wiki-discover`, `wiki-digest`, `wiki-run`, and `wiki-req`, each with valid `name` and `description` YAML frontmatter.

#### Scenario: Skills appear as first-class slash commands
- **WHEN** the plugin is loaded in Antigravity
- **THEN** each `/wiki-*` skill is selectable via `/` slash command autocomplete and `llm-wiki` serves as the on-demand schema reference

#### Scenario: Explicit on-demand scoping in descriptions
- **WHEN** a user runs an ordinary coding conversation unrelated to `.llm-wiki/`
- **THEN** skill descriptions scope activation strictly to explicit `/wiki-*` commands or explicit wiki requests and inject no ambient memory behavior

### Requirement: Unified OKF v0.2 and Obsidian templates
The plugin SHALL include unified templates under `templates/` (`WIKI_SCHEMA.md` and page templates for `source`, `entity`, `concept`, `synthesis`, `analysis`, and `requirement`) using `raw/sources/SRC-YYYY-MM-DD-NNN/` references and folder-qualified links.

#### Scenario: No legacy raw/articles drift in templates
- **WHEN** a source, entity, concept, or requirement page template is inspected or instantiated
- **THEN** citation examples reference canonical `raw/sources/SRC-YYYY-MM-DD-NNN/` packets and folder-qualified links (`[label](/folder/page.md)` or `[[folder/page]]`)

### Requirement: Reliable relative CLI invocation
Every operational `/wiki-*` skill SHALL invoke the shared CLI via a deterministic path relative to its skill directory (`../../scripts/wiki.mjs`) and execute mechanical operations without hand-editing `raw/` or `meta/`.

#### Scenario: Skill resolves CLI from installed plugin root
- **WHEN** any `/wiki-*` skill executes from `~/.gemini/config/plugins/llm-wiki/skills/<name>/SKILL.md`
- **THEN** the agent locates `../../scripts/wiki.mjs` cleanly regardless of which workspace directory is active

### Requirement: Wiki initialization and standalone capture workflows
`/wiki-init` SHALL ask for a missing topic and invoke `init`, while `/wiki-capture` SHALL accept a URL, local file path, or pasted text and invoke `capture` without running synthesis.

#### Scenario: Initialize workspace wiki via slash command
- **WHEN** a user runs `/wiki-init "Distributed Systems" --mode company`
- **THEN** the workflow invokes `wiki.mjs init` in the active workspace and suggests capturing initial sources

#### Scenario: Capture source packet only
- **WHEN** a user runs `/wiki-capture https://example.com/article`
- **THEN** the workflow creates an immutable source packet and skeleton source page and stops without modifying canonical pages

### Requirement: Source ingestion and batch synthesis workflow
`/wiki-ingest` SHALL accept either existing pending source IDs or a direct URL/file/text (capturing first), guide synthesis into source, entity, and concept pages with source-ID citations and contradiction markers, and finish with `rebuild`.

#### Scenario: Direct URL ingestion in one command
- **WHEN** a user runs `/wiki-ingest https://example.com/paper.pdf`
- **THEN** the skill captures the source first, reads `extracted.md`, updates `wiki/sources/SRC-*.md` plus entity/concept pages, and runs `wiki.mjs rebuild`

#### Scenario: Batch synthesis isolation option
- **WHEN** `/wiki-ingest` processes multiple pending sources at once
- **THEN** the skill allows delegating per-source synthesis to subagents while running `wiki.mjs rebuild` once after pages are written

### Requirement: Read-only wiki query workflow
`/wiki-query` SHALL search the workspace wiki via `wiki.mjs search`, read full matched pages before answering, synthesize an answer grounded strictly in wiki content with citations, file an `analysis`/`synthesis` page only when warranted or requested, and log a `query` event.

#### Scenario: Answer grounded strictly in wiki pages
- **WHEN** a user asks `/wiki-query How does caching work here?` and the wiki has no coverage
- **THEN** the workflow reports the knowledge gap instead of filling it from general model knowledge and logs the query

### Requirement: Health linting, status, and reporting workflows
`/wiki-lint` SHALL invoke `wiki.mjs lint [--fix]` and highlight contradictions for human review without auto-resolving them, while `/wiki-status` SHALL present `wiki.mjs status` metrics and suggest `/wiki-lint` when warnings exist.

#### Scenario: Contradictions preserved for human judgment
- **WHEN** `/wiki-lint --fix` surfaces contradictions between pages
- **THEN** mechanical fixes apply only to qualifying missing-concept stubs and contradictions are presented to the user for manual resolution

### Requirement: Discovery, digest, and manual cycle workflows
`/wiki-discover` SHALL combine `wiki.mjs status` and `.discoveries/gaps.json` with web search to capture up to 5–10 new sources, `/wiki-digest` SHALL summarize recent activity into `outputs/digest-YYYY-MM-DD.md`, and `/wiki-run` SHALL execute `discover -> ingest -> lint` manually without cron scheduling.

#### Scenario: Manual run omits scheduling flags
- **WHEN** a user runs `/wiki-run`
- **THEN** the workflow executes discovery, ingestion, linting, and writes `outputs/run-YYYY-MM-DD.md` without proposing or installing cron schedules

### Requirement: Interactive requirements decomposition workflow
`/wiki-req` SHALL clarify ambiguous scope with the user, capture the agreed concept verbatim via `wiki.mjs capture --text`, decompose each testable unit into `wiki/requirements/` via `wiki.mjs ensure --type requirement`, cross-link pages, and run `wiki.mjs rebuild`.

#### Scenario: Clarified concept preserved before decomposition
- **WHEN** `/wiki-req` reaches agreement with the user on requirements
- **THEN** the original clarified text is saved as an immutable `SRC-*` packet before any requirement page is created

### Requirement: Strict exclusion of always-on memory workflows
The skill set SHALL omit `/wiki-retro`, `wiki_observe`, trajectory working-memory commands (`/wiki-record`, `/wiki-skills`, `/wiki-trajectories`), `wiki_watch`, and Pi TUI commands (`/wiki-model`, `/wiki-settings`, `/wiki-dashboard`).

#### Scenario: Excluded memory skills are absent
- **WHEN** the `plugins/llm-wiki/skills/` directory is enumerated
- **THEN** none of the excluded memory, trajectory, or Pi TUI skill folders exist
