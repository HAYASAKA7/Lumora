# Remote provider session catalog design

## Purpose

Lumora will discover provider-owned sessions on a connected remote computer for
the same seven providers that have complete local session management: Codex,
Claude Code, Gemini CLI, OpenCode, GitHub Copilot CLI, Qwen Code, and Kimi Code. The remote
catalog remains read-only in this phase. It does not create a Lumora-owned
session format. The catalog layer remains metadata-only; the separate remote
runtime consumes its validated identities for exact resume and terminal launch.

## Architecture

The remote helper owns discovery because it runs beside the provider data. It
normalizes session metadata before sending results through the existing framed
SSH helper protocol. The desktop main process validates every response, strips
helper-private source keys, combines provider pages, and feeds the existing
Home, Workspaces, and All Sessions views.

Provider discovery is implemented as a registry of isolated Go adapters. An
adapter failure cannot prevent another enabled provider from being scanned.
Launch-only providers remain outside the registry and are not presented as
session-capable providers.

## Provider strategies

- **Codex:** start the installed Codex CLI in app-server mode, perform the
  bounded initialization exchange, and paginate `thread/list` using updated
  time ordering. Ignore ephemeral threads. Use the provider's native ID,
  workspace, name, timestamps, and rollout path. Inspect the rollout file only
  for bounded lifetime-token metadata.
- **OpenCode:** keep the existing bounded database query with the legacy JSON
  session-list fallback.
- **Claude Code:** enumerate JSONL files below the configured Claude projects
  root. Read bounded prefix and tail segments for identity, workspace, title,
  and timestamps, and inspect bounded token-usage fields without returning
  messages.
- **Gemini CLI:** enumerate project chat files below the configured Gemini
  storage root and parse its provider-owned JSON or JSONL metadata format.
- **GitHub Copilot CLI:** enumerate UUID session directories below the
  configured Copilot session-state root. Prefer `events.jsonl`, with
  `workspace.yaml` as the legacy metadata source.
- **Qwen Code:** enumerate provider recordings below the configured Qwen
  projects root and parse bounded JSONL metadata and token usage.
- **Kimi Code:** stream the bounded native `session_index.jsonl`, validate each
  contained session directory, read bounded `state.json` metadata, and sum
  effective lifetime usage from bounded agent `wire.jsonl` files.

Provider storage roots honor the same environment overrides as local Lumora:
`CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `GEMINI_CLI_HOME`, `COPILOT_HOME`,
`QWEN_RUNTIME_DIR`, `QWEN_HOME`, and `KIMI_CODE_HOME`. Empty or relative overrides are rejected in
favor of the provider's default directory below the remote home directory.

## Data and privacy boundaries

Each returned session contains only:

- provider-native session ID;
- absolute workspace path;
- title;
- creation and update timestamps;
- optional all-time token total;
- a helper-private source key used only while building the remote snapshot.

Prompts, responses, tool calls, environment variables, credentials, API keys,
and raw transcript records never cross the helper protocol. The desktop main
process removes the source key before exposing the catalog to a renderer.

## Bounds and consistency

Discovery retains the existing 64 KiB control-frame limit and maximum page
size of 100 records. File adapters cap enumeration, individual file size,
prefix reads, tail reads, and token inspection. CLI adapters cap execution
time, output bytes, and page counts. Invalid records increment a bounded count
and do not expose parser details.

The helper creates one immutable normalized snapshot when Lumora requests
cursor zero for a provider. Later cursors page through that same snapshot, so
one catalog refresh does not repeatedly scan files or return inconsistent
pages. A later cursor-zero request replaces the provider snapshot. Snapshots
are held only in memory and are discarded when the helper exits.

## Status and failure behavior

Remote provider catalog status has four explicit outcomes:

- `ready`: the adapter completed, including a valid empty catalog;
- `unavailable`: the provider executable is not installed or cannot be found;
- `unsupported`: the helper has no session adapter for that provider;
- `failed`: the installed provider or its storage could not be scanned safely.

Malformed and oversized individual sources are skipped under a `ready` result
and counted as invalid. A provider-wide command, storage, or protocol failure
returns `failed`. Other providers continue scanning. UI messages remain
sanitized and never include remote paths beyond already-normalized workspace
metadata.

## Testing

Each provider adapter uses provider-shaped fixtures for valid metadata,
renamed sessions, duplicates, malformed records, oversized sources, and token
totals. Registry tests cover all seven adapters and isolate failures. Snapshot
tests prove that later pages do not rescan and cursor zero refreshes the cache.
Protocol tests cover the new `failed` status, maximum records, maximum frame
size, and source-key removal. The complete Go, TypeScript, renderer, typecheck,
and production-build verification remains required before handoff.

## Manual acceptance

On a Linux, macOS, or Windows remote target with any supported provider
installed, refreshing the remote catalog must show that provider's native
sessions in Home, Workspaces, and All Sessions. Disabled providers must not be
scanned. A provider with no sessions must show a successful empty state, while
an unavailable or failed provider must show its distinct sanitized status.
