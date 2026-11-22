# Spec Delta

## Purpose

Provides a deterministic, zero-dependency CLI engine that manages workspace-local `.llm-wiki/` knowledge vaults compatible with Open Knowledge Format (OKF) v0.2 and Obsidian without any personal-vault fallback or background daemon.

## ADDED Requirements

### Requirement: Workspace-local vault resolution
The CLI SHALL resolve the target `.llm-wiki/` vault strictly from an explicit `--root <dir>` path or by walking upward from the current working directory, and SHALL never fall back to `$HOME/.llm-wiki/` or `WIKI_HOME`.

#### Scenario: Resolves vault from ancestor directory
- **WHEN** a user runs a vault command inside a nested workspace subdirectory whose ancestor contains `.llm-wiki/config.json`
- **THEN** the CLI targets that workspace ancestor `.llm-wiki/` vault

#### Scenario: Never falls back to home personal vault
- **WHEN** a user runs a non-`init` command in a workspace with no `.llm-wiki/` directory even if `$HOME/.llm-wiki/config.json` exists
- **THEN** the CLI fails with a non-zero exit code and reports that no workspace wiki vault was found

### Requirement: Vault initialization and schema scaffolding
The `init` command SHALL scaffold `.llm-wiki/` at the target root with `config.json` (`knowledge_format: "okf-0.2"`, `vault_id`, `mode`, `topic`), `WIKI_SCHEMA.md`, `raw/sources/`, `wiki/{sources,entities,concepts,syntheses,analyses,requirements}/`, `meta/`, `outputs/`, and `.discoveries/`.

#### Scenario: Fresh vault initialization
- **WHEN** `init --topic "AI Engineering" --mode company` runs in a directory without `.llm-wiki/`
- **THEN** the directory tree, `config.json`, `WIKI_SCHEMA.md`, initial `meta/` files, and a `bootstrap` event in `meta/events.jsonl` are created

#### Scenario: Idempotent re-initialization
- **WHEN** `init` runs again on an existing valid vault
- **THEN** the CLI updates vault configuration metadata, preserves existing `wiki/` pages and `raw/` packets, and rebuilds projections

### Requirement: Immutable source packet capture
The `capture` command SHALL accept `--url`, `--file`, or inline/piped text (`--text`, `--text-file`, or `-`), store an immutable packet under `raw/sources/SRC-YYYY-MM-DD-NNN/` (`manifest.json`, `original/`, `extracted.md`, `attachments/`), create a skeleton `wiki/sources/SRC-*.md` page, and append a `capture` event.

#### Scenario: Capture local text or markdown file
- **WHEN** `capture --file ./notes/design.md` runs in an initialized vault
- **THEN** a sequential `SRC-YYYY-MM-DD-NNN` packet is created with the original copy, `extracted.md`, `manifest.json`, and a skeleton page in `wiki/sources/`
- **AND** any public `capture` log projection omits machine-local absolute file paths

#### Scenario: Reject missing input source
- **WHEN** `capture` is invoked without `--url`, `--file`, or text input
- **THEN** the CLI exits non-zero with a clear usage error and writes no packet files

### Requirement: Format-aware source content extraction
The `capture` command SHALL normalize HTML, JSON, XML, plain text, PDF, and DOCX inputs into markdown while detecting unextractable binary files by magic bytes and marking them as `unsupported` instead of corrupting `extracted.md`.

#### Scenario: PDF fallback extraction
- **WHEN** a local `.pdf` file or PDF URL is captured in an environment without `markitdown` but with `pdftotext` available
- **THEN** the CLI extracts readable text via `pdftotext` and records the extractor metadata in `manifest.json`

#### Scenario: Unsupported binary rejection
- **WHEN** `capture --file` is given an executable or image binary without a supported text extractor
- **THEN** the CLI preserves the file in `original/`, writes a clear failure note in `extracted.md`, and sets `extraction_status` to `unsupported`

### Requirement: Pending source queue inspection
The `pending` command SHALL list captured `SRC-*` packets whose corresponding `wiki/sources/SRC-*.md` page is missing or has `status: skeleton`, supporting `--source-id` and `--batch <n>` filters.

#### Scenario: Filter pending source packets
- **WHEN** a vault has both synthesized and skeleton source pages and `pending --batch 2` runs
- **THEN** the CLI returns only up to two uningested source packets with their IDs, titles, manifest metadata, and `extracted.md` paths

### Requirement: Safe canonical page creation
The `ensure` command SHALL resolve or create canonical pages in `wiki/` (`entity`, `concept`, `synthesis`, `analysis`, `requirement`, or custom types defined in `config.json`), enforcing kebab-case filenames, merging optional body frontmatter without overwriting reserved fields, and validating links.

#### Scenario: Create new canonical page
- **WHEN** `ensure --type concept --title "Retrieval Augmented Generation"` runs
- **THEN** `wiki/concepts/retrieval-augmented-generation.md` is created with canonical frontmatter, an `ensure_page` event is logged, and metadata is rebuilt

#### Scenario: Idempotent lookup of existing page
- **WHEN** `ensure` is called for a type and title whose target slug already exists
- **THEN** the CLI leaves the existing file untouched and reports that the page already exists

### Requirement: Deterministic atomic metadata projections
The `rebuild` command SHALL fail-closed on malformed frontmatter or identity collisions and otherwise atomically write `meta/registry.json`, `meta/backlinks.json`, `meta/index.md`, `meta/log.md`, OKF v0.2 `wiki/index.md` directory indexes, and `wiki/log.md`.

#### Scenario: Extract both link syntaxes outside code blocks
- **WHEN** `rebuild` indexes pages containing `[[folder/page]]`, `[[folder/page\|alias]]`, `[label](/folder/page.md)`, and sample links inside fenced code blocks
- **THEN** `backlinks.json` records resolved links from prose and ignores links inside inline code or fenced code blocks

#### Scenario: Fail-closed on corrupt page frontmatter
- **WHEN** a file in `wiki/` contains unparseable YAML frontmatter or a duplicate page identity collision
- **THEN** `rebuild` exits non-zero with file-level diagnostics and leaves existing `meta/` files unmodified

### Requirement: Lexical and multilingual search
The `search` command SHALL rank pages across `meta/registry.json` and `wiki/` using whole-word matching for Latin tokens, overlapping bigrams/trigrams for CJK queries, and field weights across titles, aliases, tags, headings, and body chunks, supporting `--type`, `--max`, and `--links-only`.

#### Scenario: Prevent short-token substring noise
- **WHEN** a user runs `search "to go"` against pages containing `"history"` and `"Golang"`
- **THEN** whole-word matching scores `"go"` against `"Golang"`/`"Go"` while `"to"` does not falsely match `"history"`

#### Scenario: Links-first scaling threshold
- **WHEN** a vault contains more than 50 registered pages and `search` runs without disabling links-first mode
- **THEN** results return ranked IDs, titles, types, scores, paths, and one-line snippets instead of full body previews

### Requirement: Wiki health linting and safe auto-fix
The `lint` command SHALL detect orphan pages, unresolved links, ambiguous wikilinks, and `⚠️ **Contradiction` flags, persist `.discoveries/gaps.json`, and with `--fix` generate `wiki/concepts/<slug>.md` stubs for gaps cited by two or more pages plus `outputs/lint-YYYY-MM-DD.md`.

#### Scenario: Contradictions never auto-resolved
- **WHEN** `lint --fix` scans pages containing `⚠️ **Contradiction` markers and unresolved concept links cited twice
- **THEN** stub pages are created for the repeated missing concepts while contradictions remain flagged for human review

### Requirement: Status reporting and structured event logging
The `status` command SHALL report knowledge format, page counts by type, pending raw sources, zero-backlink orphans, tracked gaps, and recent events, while `log` SHALL append validated events to `meta/events.jsonl` and refresh log views.

#### Scenario: Reject reserved event field override
- **WHEN** `log --kind query --details '{"kind":"override","timestamp":"bad"}'` is executed
- **THEN** the CLI rejects overriding `kind` or `timestamp` and exits non-zero without modifying `meta/events.jsonl`

### Requirement: Uniform CLI output and zero npm dependencies
All CLI subcommands SHALL execute directly under Node.js >= 22 with zero third-party npm packages, accept `--json` for structured machine output alongside default Markdown summaries, and return non-zero exit codes on errors.

#### Scenario: Machine-readable JSON output
- **WHEN** any subcommand is invoked with `--json`
- **THEN** stdout contains a single valid JSON object reflecting the operation result or error diagnostics
