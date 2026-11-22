# LLM Wiki Schema

> Workspace-local knowledge base following Karpathy's LLM Wiki pattern and Open Knowledge Format (OKF) v0.2.

## Ownership Rules

| Path | Owner | Rule |
|---|---|---|
| `raw/**` | `wiki.mjs` CLI | Immutable after capture — never edit by hand |
| `wiki/**` | Agent + user | Editable Markdown knowledge pages (`wiki/index.md` and `wiki/log.md` are generated in `okf-0.2` mode) |
| `meta/events.jsonl` | `wiki.mjs` CLI | Append-only authoritative activity log; preserve in backups |
| `meta/*` (except `events.jsonl`) | `wiki.mjs` CLI | Generated deterministic projections (`registry.json`, `backlinks.json`, `index.md`, `log.md`) |
| `outputs/**` | Agent + CLI | Generated digests, lint reports, and run summaries |
| `WIKI_SCHEMA.md`, `config.json` | Human + explicit request | Operating conventions and vault settings |

## Vault Layout

```text
.llm-wiki/
├── config.json                     # Vault metadata & settings (knowledge_format: okf-0.2)
├── WIKI_SCHEMA.md                  # This operating manual
├── templates/                      # Page templates
├── raw/
│   ├── assets/                     # Supporting binary assets
│   └── sources/
│       └── SRC-YYYY-MM-DD-NNN/     # Immutable source packets
│           ├── manifest.json       # Capture metadata (id, title, url/format, extractor)
│           ├── original/           # Preserved original artifact (when URL or file)
│           ├── extracted.md        # Normalized Markdown text
│           └── attachments/        # Auxiliary attachments
├── wiki/                           # Obsidian-compatible Markdown vault
│   ├── index.md                    # Generated OKF v0.2 root index (do not hand-edit)
│   ├── log.md                      # Generated OKF v0.2 log snapshot (do not hand-edit)
│   ├── sources/                    # Source summary pages (`SRC-YYYY-MM-DD-NNN.md`)
│   ├── entities/                   # People, orgs, tools, products, projects
│   ├── concepts/                   # Ideas, patterns, frameworks, mechanisms
│   ├── syntheses/                  # Cross-source theses and tensions
│   ├── analyses/                   # Durable filed query answers
│   └── requirements/               # Atomic traceable requirements
├── meta/
│   ├── events.jsonl                # Authoritative append-only event stream
│   ├── registry.json               # Master page index
│   ├── backlinks.json              # Inbound link graph
│   ├── index.md                    # Rich type-grouped catalog
│   └── log.md                      # Chronological activity log
├── outputs/                        # Lint reports, digests, and run summaries
└── .discoveries/                   # Unresolved link gaps snapshot (`gaps.json`)
```

## Page Types & Styles

- **source** (`wiki/sources/SRC-YYYY-MM-DD-NNN.md`) — what a specific raw packet says
- **entity** (`wiki/entities/<slug>.md`) — people, organizations, tools, projects, products
- **concept** (`wiki/concepts/<slug>.md`) — ideas, patterns, frameworks
- **synthesis** (`wiki/syntheses/<slug>.md`) — cross-cutting multi-source analyses and tensions
- **analysis** (`wiki/analyses/<slug>.md`) — durable filed answers from `/wiki-query`
- **requirement** (`wiki/requirements/<slug>.md`) — atomic requirements with acceptance criteria and traceability

Vault `mode` in `config.json` controls schema style within this workspace only (never a global vault):
- `personal` — learning notes, reading summaries, concepts, reflections
- `company` — competitive intelligence, architecture decisions, RFCs, product tracking (`confidence: high | medium | low`)

## Linking & Citation Conventions

- Use `kebab-case.md` filenames for canonical pages.
- Prefer folder-qualified links so Obsidian and OKF resolve targets unambiguously:
  - Standard Markdown: `[Retrieval-Augmented Generation](/concepts/retrieval-augmented-generation.md)`
  - Wikilink: `[[concepts/retrieval-augmented-generation]]` or `[[entities/openai|OpenAI]]`
- Inside Markdown table cells, escape wikilink alias pipes as `[[target\|alias]]`.
- Cite claims back to stable source IDs: `[[sources/SRC-YYYY-MM-DD-NNN]]` or `[SRC-YYYY-MM-DD-NNN](/sources/SRC-YYYY-MM-DD-NNN.md)`.
- Flag conflicting evidence openly with:
  ```markdown
  > ⚠️ **Contradiction:** Source A claims X, whereas Source B claims Y.
  > See [[sources/SRC-2026-11-22-001]] and [[sources/SRC-2026-11-22-002]].
  ```
