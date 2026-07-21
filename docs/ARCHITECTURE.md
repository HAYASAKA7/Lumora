# Lumora architecture

This document describes Lumora's public technical architecture, security
boundaries, local data model, and provider integration approach. For everyday
use, start with the [user guide](../README.md).

## System overview

```text
Sandboxed React renderer + xterm.js
                  |
      typed, schema-validated preload API
                  |
          Electron main process
        /          |           \
 provider adapters |       platform services
 native agent CLIs |    Windows / macOS / Linux
                   |
            node-pty runtime host
                   |
        local Node.js SQLite database
```

Lumora separates presentation from privileged operations. The renderer displays
catalog data and terminals, while the main process owns filesystem discovery,
process creation, PTY I/O, persistence, native dialogs, clipboard access, and
external-link handling.

## Process boundaries

### Renderer

The React renderer owns navigation and UI state. It cannot use Node.js APIs,
read provider files, open the database, or spawn a process directly. Electron
runs it with:

- sandboxing enabled;
- context isolation enabled;
- Node.js integration disabled;
- a restrictive content security policy.

The renderer keeps active terminal components mounted while application routes
change. This preserves PTY attachments and avoids recreating terminal views on
ordinary navigation.

### Preload API

The preload layer exposes a narrow `window.lumora` API. Every request and
response is parsed through shared Zod contracts. It does not expose Electron's
general-purpose IPC or Node.js APIs to the renderer.

### Main process

The main process validates the sender and request again before privileged work.
It owns:

- provider executable discovery and compatibility probes;
- provider installation/update actions and official-guide links;
- read-only session-source scanning;
- workspace canonicalization and catalog refreshes;
- launch configuration and workspace trust;
- PTY process lifecycle and runtime events;
- SQLite migrations and repositories;
- native window, menu, clipboard, and dialog integration.

New-window requests are denied, and navigation is restricted to Lumora's
packaged application origin or its known development origin.

## Provider model

The shared provider definitions are the source of truth for display names,
commands, version arguments, installation methods, and session-support level.
Providers fall into two groups:

- **Complete session support:** launch, discover provider-owned sessions, and
  resume an exact native session.
- **Launch-only support:** discover and launch the provider command without
  indexing or resuming saved sessions.

Session adapters parse provider metadata into Lumora's normalized catalog.
Provider files are inputs, not Lumora-managed storage. A malformed provider
record produces a diagnostic without hiding healthy providers or deleting the
last good catalog snapshot.

## Catalog flow

```text
Provider session directories
          |
 read-only source adapters
          |
 normalize + validate
          |
 local catalog database
          |
 query by workspace, provider, and text
          |
 renderer views
```

The catalog stores the metadata needed to identify and display a session. It
does not copy transcript bodies. Workspaces can come from provider discovery or
manual selection, and canonical paths are used to avoid duplicate identities.

Catalog refreshes run at startup, on user request, on a schedule, and shortly
after a managed provider exits. Search results use request ownership so a slow,
stale response cannot replace a newer query.

## Launch and runtime flow

Launch settings resolve in increasing precedence:

```text
Global < Provider < Workspace < Session < One-time launch
```

Before spawning a process, the main process:

1. resolves the provider and terminal profile;
2. canonicalizes the working directory;
3. resolves layered launch settings;
4. requires trust for the exact workspace identity and path;
5. creates a launch preview;
6. starts the command through `node-pty` only after confirmation.

The runtime host owns terminal input, output, resize, state changes, and
termination. The renderer attaches to it through IPC and receives sequenced
runtime events. Lumora records managed runtime history, but generic PTYs cannot
be reattached after the application process exits; those runtimes are marked
honestly as lost and can be resumed or restarted.

## Local storage

Lumora uses one migrated SQLite database under Electron's `userData` directory.
It stores:

- normalized workspace and session metadata;
- terminal profiles and provider command overrides;
- layered launch settings;
- keyboard preferences;
- workspace trust decisions;
- managed runtime and reconciliation history.

Window size and maximized state are stored separately in `window-state.json`.
Development builds append `-dev` to the default application-data path so they
do not share data with an installed package.

## Privacy and trust

Lumora has no Lumora cloud synchronization. Provider session sources are read
without rewriting them, and transcript bodies are not imported into Lumora's
catalog.

The provider CLI is still an independent program. It may read files, execute
commands, or contact its own services according to the provider's configuration
and the operating-system permissions of the user who launched Lumora.

Workspace trust is therefore a persistent, revocable consent gate—not a
sandbox or filesystem boundary. It records a workspace ID, canonical path, and
timestamp. A changed path requires a new decision.

## Platform integration

Lumora uses platform-specific application icons and native packaging targets.
Windows and Linux remove the default application menu. macOS retains the native
menu in the system menu bar. Window bounds are restored only when they still fit
an available display, and maximized state is persisted independently.

## Intentional future scope

### Read-only session preview

Lumora may add a Session Details view that lets users identify a saved session
before resuming it. This is intentionally deferred because it requires a
provider-specific content-reading layer in addition to the existing metadata
catalog.

The planned boundaries are:

- load previews only when the user opens Session Details;
- support every provider that has complete session support;
- normalize only a small number of recent user and assistant messages;
- exclude system messages, reasoning, tool calls, tool output, and provider
  internals;
- keep provider source paths and raw records inside the main process;
- apply strict per-message, total-size, timeout, and file-size limits;
- render plain text and expose clear unavailable and retry states;
- never save preview content in the catalog, application logs, or a persistent
  cache; and
- keep resuming as a separate, explicit action using the existing launch and
  trust flow.

The expected provider adapters are Codex history APIs, OpenCode's structured
session export, and bounded read-only parsing of the provider-owned files used
by Claude Code, Gemini, GitHub Copilot CLI, and Qwen Code. A preview failure
must not prevent an otherwise valid session from being resumed.

## Important source areas

| Path | Responsibility |
| --- | --- |
| `src/main/catalog/` | Catalog composition, querying, and refresh runtime |
| `src/main/providers/` | Provider discovery and session-source adapters |
| `src/main/terminal/` | Launch resolution, PTY runtime, recovery, reconciliation |
| `src/main/storage/` | SQLite migrations and repositories |
| `src/main/ipc/` | Validated privileged IPC handlers |
| `src/preload/` | Typed renderer bridge |
| `src/renderer/src/catalog/` | Home, workspace, and session views |
| `src/renderer/src/terminal/` | Terminal workspace and xterm integration |
| `src/renderer/src/settings/` | Categorized application settings |
| `src/shared/` | Contracts and provider definitions shared across processes |
