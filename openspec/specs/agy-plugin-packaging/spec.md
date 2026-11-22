# agy-plugin-packaging Specification

## Purpose

Defines the Antigravity plugin bundle structure under `plugins/llm-wiki/` and an idempotent installer targeting `~/.gemini/config/plugins/llm-wiki/` with zero ambient hooks, rules, or MCP servers.

## Requirements

### Requirement: Valid Antigravity plugin manifest
The plugin SHALL provide `plugins/llm-wiki/plugin.json` declaring only supported Antigravity manifest fields (`name: "llm-wiki"`, `displayName: "LLM Wiki"`, `description`, `version`, and three `suggestedPrompts`).

#### Scenario: Manifest contains only valid Antigravity fields
- **WHEN** `plugins/llm-wiki/plugin.json` is parsed as JSON
- **THEN** it contains `name`, `displayName`, `description`, `version`, and a three-item `suggestedPrompts` array, and no unsupported top-level keys

### Requirement: Non-ambient plugin bundle layout
The `plugins/llm-wiki/` bundle SHALL contain only `plugin.json`, `README.md`, `scripts/`, `templates/`, and `skills/`, and SHALL NOT ship `hooks.json`, `mcp_config.json`, `rules/`, `.claude-plugin/`, `.pi/`, or `.omp/`.

#### Scenario: Zero ambient hooks, rules, or MCP configs
- **WHEN** the installed plugin directory is inspected
- **THEN** no `hooks.json`, `mcp_config.json`, `rules/`, `.claude-plugin/`, `.pi/`, or `.omp/` entries exist anywhere in the bundle

### Requirement: Idempotent installation to global Antigravity plugins directory
An installer script SHALL install `plugins/llm-wiki/` to `~/.gemini/config/plugins/llm-wiki/` using a symlink by default or a directory copy with `--copy`, create parent directories as needed, and support `--uninstall` and `--force`.

#### Scenario: Default symlink install and idempotent re-run
- **WHEN** the installer runs with default options and then runs a second time
- **THEN** `~/.gemini/config/plugins/llm-wiki` resolves cleanly to `plugins/llm-wiki` without error on either invocation

#### Scenario: Protect unrelated existing destination
- **WHEN** `~/.gemini/config/plugins/llm-wiki` already exists as an unrelated directory or symlink pointing elsewhere and `--force` is not passed
- **THEN** the installer exits non-zero and leaves the existing destination untouched

#### Scenario: Clean copy install and uninstall
- **WHEN** the installer runs with `--copy` and subsequently runs with `--uninstall`
- **THEN** a self-contained copy exists during installation and is removed cleanly on uninstall without deleting `plugins/llm-wiki/` in the repository
