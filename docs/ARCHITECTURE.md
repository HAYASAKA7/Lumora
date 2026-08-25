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

A renderer-root tooltip provider owns one portal-based hover surface. Tooltip
placement is clamped to the viewport, uses semantic appearance tokens, and
supports delayed pointer intent, deliberate keyboard focus, shortcut labels,
and overflow-only disclosure. Renderer JSX is contract-tested to reject native
`title` attributes so browser-owned hover bubbles cannot silently return.

App-style focus handling is scoped to navigation, catalog cards, and page
commands. Those controls leave the browser Tab cycle and release stale pointer
focus before ordinary typing or application shortcuts. Editable fields,
dialogs, settings, transfer workflows, shortcut recording, and managed
terminals retain their native focus behavior.

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

### Remote target boundary

Remote profiles, host trust, and connection state live in the main process and
SQLite. A remote target opens in its own BrowserWindow with an immutable target
context. Remote-window IPC may read, connect, disconnect, inspect helper state,
or confirm helper installation only for that bound target. It cannot enumerate
or mutate other targets, and helper IPC accepts no renderer-provided target ID.
Profile edits and deletion first close the bound window and dispose active SSH,
helper, and file-transfer resources.

Remote windows receive a narrow read-only projection of the global appearance
settings and managed-background state. Appearance selection and file mutations
remain local-window-only IPC operations.

The SSH connection verifies a stored SHA-256 host fingerprint before sending
credentials. Passwords and private-key passphrases remain memory-only by
default. When a user explicitly remembers one profile's credential, the main
process encrypts it with Electron's operating-system-backed `safeStorage` and
stores only the encrypted blob in a separate credential table. Credential
plaintext is never added to the profile DTO, returned after submission, or
logged. Linux `basic_text` fallback is rejected rather than treated as secure
storage. On Windows, DPAPI prevents another operating-system account from
decrypting the blob but does not isolate it from every process already running
as the same user.

Automatic connection is a separate per-profile preference and defaults off.
It works with remembered passwords, private keys with an optional remembered
passphrase, and SSH agents. Opening the isolated remote window performs at most
one automatic attempt after host trust has been verified; failure returns to
the same manual connection UI. Authentication-method changes and profile
deletion remove remembered credentials and disable the preference. After
authentication, Lumora probes the remote OS, architecture, home directory, and
shell before choosing a packaged helper artifact; local and remote platforms
are independent.

Helper artifacts are built for Windows, macOS, and Linux on x64 and arm64. A
bounded manifest records target, size, SHA-256 digest, protocol version, and
capabilities. Lumora validates the local artifact, uploads to a private
versioned per-user path, checks the remote digest, and atomically renames the
verified temporary file. Existing invalid helpers are removed only after the
replacement upload has passed verification and the user confirmed replacement.

The helper uses length-prefixed, schema-validated frames with bounded payloads,
timeouts, generation-bound request IDs, and an initial compatibility handshake.
The helper capabilities cover system information, allowlisted provider
discovery, explicitly confirmed lifecycle actions for generated npm package
identifiers, and bounded provider-owned session metadata. Lifecycle execution
uses structured arguments, no elevation or shell-profile mutation, a fixed
timeout, and bounded output that is never returned to the renderer. Interactive execution
does not turn the helper into a daemon: the Electron main process opens a
separate SSH PTY channel for each authorized remote runtime, while the helper
continues to own only bounded discovery.

Remote launch preparation resolves the target from the immutable sender-window
context, refreshes target-scoped discovery and catalog state, and revalidates
the provider executable, workspace, native session identity, start command,
and workspace trust in the main process. Target-specific launch settings live
in the target's terminal repository. Runtime events are routed only to the
matching isolated window; local windows never subscribe to remote PTY output.

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

Codex, Claude Code, and OpenCode adapters also expose their documented native
fork arguments. A native fork is a same-provider launch that references the
source native session ID, creates a distinct provider-owned session identity,
and never copies or rewrites the source transcript.

Complete-session adapters also expose a bounded handoff snapshot operation.
File-backed providers copy the selected source before parsing it; OpenCode uses
its structured export command. This operation is separate from catalog scans
and runs only for a user-confirmed cross-agent launch.

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

Workspace visibility is a non-destructive renderer projection over a complete
catalog snapshot. Target-scoped policies can hide only a workspace card or the
card and its sessions; independent General settings can omit unavailable
workspaces and unusable sessions. Search and provider filters are applied to
the projected in-memory snapshot, so typing does not trigger database reads or
provider scans. A failed policy read fails open, and neither visibility mode
changes provider-owned files or normalized catalog rows.

## Cross-device transfer flow

Cross-device transfer moves provider-owned session files without changing the
provider's native payload. It is distinct from cross-agent handoff: transfer
continues with the same provider on another device, while handoff creates a new
session in a different provider from normalized temporary context.

```text
stopped catalog sessions
          |
 capability and active-runtime gate
          |
 provider-native export adapter
          |
 streamed .lumora-sessions archive
          |
 native file transfer chosen by the user
          |
 authenticated inspection + workspace mapping
          |
 provider-native import + exact verification
```

The renderer receives opaque, expiring operation tokens rather than source,
staging, or archive paths. Native dialogs select the archive and destination;
all filesystem access, provider commands, extraction, and cleanup stay in the
main process. Export preparation is repeated authoritatively before writing, so
running, stale, unavailable, changed, and unverified sessions are excluded even
when the renderer previously considered them selectable.

An archive contains a strict manifest and one native payload per session. Entry
names, counts, sizes, hashes, paths, decompressed size, and manifest structure
are bounded and validated. Archive creation and extraction are streamed through
temporary files rather than accumulated in renderer or main-process memory.
Encrypted archives use scrypt-derived AES-256-GCM keys and authenticate the
public envelope; encryption is enabled by default. Unencrypted export requires
an explicit user choice.

The manifest records only session identity, title, workspace mapping hints,
source platform, provider version, and payload metadata. Transfer never includes
provider configuration and never transfers provider credentials, authentication
tokens, API keys, Lumora settings, environment variables, terminal profiles, or
workspace files.

Imports are mixed-provider aware. Unsupported, missing, disabled, or unverified
providers remain untouched in the archive and can be retried later. Source
workspace roots are mapped explicitly to existing destination directories;
Lumora may register a chosen directory as a workspace but does not create or
copy the project. Duplicate provider-native IDs are skipped before provider
mutation and checked again at execution time.

Every adapter must import through a documented provider-native path, verify the
exact native ID, workspace, and title through fresh discovery, and expose a
rollback path when the provider permits one. A failed verification triggers
rollback; a fatal provider failure blocks later writes for that provider without
preventing independent providers from completing. The catalog refreshes only
after an import verifies successfully.

Implementation is not capability evidence. Routes are keyed by provider,
provider version, source platform, and destination platform, and remain disabled
until packaged native verification records that exact combination.
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

For an exact native resume, Lumora passes the source provider's session ID as
before.

For a native fork, Lumora revalidates the source identity and provider
capability when the launch preview is consumed, passes the provider's native
fork arguments plus the user's optional single-line initial task, and starts
with no destination session identity. When the task is empty, no prompt argument
is added. The existing reconciliation flow then links the runtime to the new
provider-owned session without changing the source session.

For an enabled cross-agent handoff, the main process instead:

1. verifies that source and destination providers are enabled, installed,
   compatible, and have complete session support;
2. reserves an immutable launch plan while showing the normal launch preview;
3. after workspace trust and final confirmation, copies the source into a new
   Lumora-managed handoff directory;
4. normalizes ordered user and assistant messages plus a compact, safe tool
   activity ledger into bounded Markdown files; and
5. launches a new destination-provider session with a bootstrap prompt that
   identifies the managed directory, treats its contents as untrusted history,
   follows the user's conversation language, summarizes the imported state,
   and waits for the user.

The destination receives a new native session identity. The source session and
its provider-owned files remain available and unchanged.

The runtime host owns terminal input, output, resize, state changes, and
termination. Adjacent PTY fragments are coalesced into bounded sequenced IPC
events, and a chunked one-mebibyte tail is retained for renderer attachment.
Runtime output is forwarded to the renderer without rebuilding the native tray;
the tray refreshes only for state or catalog changes.

Terminal paste is target-aware. The main process inspects the native clipboard
and returns plain text directly, but never sends clipboard image bytes to the
renderer. Images are validated, converted to bounded PNG files, and staged in
a private per-runtime temporary directory. Local runtimes receive a local path;
remote runtimes receive a path uploaded over their existing authenticated SFTP
connection. Xterm inserts a provider-neutral file reference without Enter, so
the user can edit the prompt before submitting it. Runtime exit removes tracked
files, while bounded startup cleanup removes stale local copies after crashes.

Stopping a managed runtime uses two bounded interrupt windows before escalating
to the native PTY close. Lumora waits for the PTY's observed exit event and
coalesces concurrent stop requests. If no exit event arrives after escalation,
the runtime is recorded as lost instead of being reported as an ordinary
completed or failed exit. Lumora records managed runtime history, but generic
PTYs cannot be reattached after the application process exits; those runtimes
are marked honestly as lost and can be resumed or restarted.

## Local storage

Lumora uses one migrated SQLite database under Electron's `userData` directory.
It stores:

- normalized workspace and session metadata;
- terminal profiles and provider command overrides;
- layered launch settings;
- keyboard preferences;
- target-scoped workspace visibility policies;
- workspace trust decisions;
- managed runtime and reconciliation history; and
- non-sensitive transfer history plus the last export and import directories.

Window size and maximized state are stored outside SQLite. The local window uses
`window-state.json`; remote target windows share `remote-window-state.json` so
their geometry remains independent from the local window while staying
consistent between remote connections. Both paths apply the global startup
maximization preference and clamp restored bounds to an available display.
Development builds append `-dev` to the default application-data path so they
do not share data with an installed package.

General settings have one application-wide owner. The local window and every
remote target window read and write the same global projection, including
catalog presentation, startup, sidebar, close, cross-agent, notification, and
appearance preferences. A schema-validated, payload-free IPC notification
causes every open renderer to reload that projection after a successful save;
the event carries no setting values or target secrets. Provider enablement,
provider commands, credentials, workspace visibility policies, and other
machine-specific configuration remain stored against an execution target.
Legacy local target rows are migrated into the global projection without
altering remote provider preferences.

Window-close behavior is stored with General settings. In hide-to-tray mode the
main window remains alive, preserving the renderer and managed PTYs. Explicit
Exit still follows the normal shutdown path and terminates managed runtimes
before closing storage. A single-instance lock restores the existing hidden
window when Lumora is launched again.

Cross-agent copies live outside SQLite under a dedicated `handoffs` directory
inside `userData`. Each directory contains the immutable source copy,
normalized context chunks, and a manifest. Startup and settings changes run
bounded cleanup using the configured retention period. The feature defaults to
off.

Cross-device imports use private operation staging directories under `userData`.
Plans and selections expire after a bounded interval, successful operations and
shutdown remove staging data, and startup removes abandoned operation
directories. Full paths, passwords, archive contents, and provider payloads are
not written to transfer history.

Lumora also keeps a bounded diagnostic journal in a dedicated `diagnostics`
directory under `userData` by default. A versioned private preference may select
another local directory. Startup validates that directory and migrates only
schema-valid bounded records before the journal is opened; an inaccessible
custom directory falls back to the default without blocking Lumora. One active
NDJSON file and two rotated files retain schema-validated lifecycle and
process-health events. An atomic active-run
marker reports an abnormal previous shutdown and is removed only after orderly
terminal, remote, transfer, and storage shutdown. The journal never contains prompts,
terminal output, session content, credentials, environment values,
exception text, stack traces, session identities, or filesystem paths.

Diagnostic IPC is local-window-only. The renderer receives a validated summary
of recent structured events, the current count of locally managed launching or
running agents, and bounded Electron process metrics for Lumora itself. The
memory value sums each Electron process's resident working set, so shared pages
may be represented more than once. Export is an explicit native save-dialog
action that creates a local JSON file. Its last successful parent directory is
remembered privately and used as the next dialog location. Native directory
dialogs prevent the renderer from submitting arbitrary paths. There is no
diagnostic upload or native crash-dump collection.

## Localization and Mods

Lumora packages immutable built-in locale catalogs with the application. On
first use, the main process resolves a supported operating-system locale and
falls back to bundled English; a later explicit language choice is global to
local and Remote Lumora windows and native application surfaces.

User language packs are data-only Mods. The active Mods root defaults to a
directory under `userData`, while a private preference can point to another
writable local directory. Changing that preference does not move or delete
content. The former per-user `locales` directory remains a compatibility
source. Catalog precedence is the active Mods pack, the legacy user pack, the
matching bundled locale, and finally immutable bundled English.

The main process owns Mods filesystem access and native folder selection.
Before activation, catalogs pass bounded schema, ICU placeholder, path, file,
and size validation. Symbolic links, unsafe keys, unexpected files, and
executable content are rejected. Reload is atomic, so a rejected update cannot
replace the last valid active catalog.

## Privacy and trust

Lumora has no Lumora cloud synchronization. Provider session sources are read
without rewriting them, and transcript bodies are not imported into Lumora's
catalog.

Cross-device transfer and cross-agent handoff are explicit exceptions to the
no-copy rule. Cross-device transfer copies only user-selected provider-native
sessions into a user-chosen local archive; Lumora never uploads it and never
rewrites the original provider source.

For cross-agent handoff, after user
confirmation, Lumora makes a temporary local copy for the selected transfer.
The copy is not indexed, synced, or written back to either provider, and it is
deleted by the configured retention policy. Historical session text is marked
as untrusted context so it cannot silently replace Lumora's bootstrap rules.

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

A persistent native tray/status item is created after application startup. Its
menu is rebuilt when window visibility, terminal runtime state, or catalog data
changes, so the running-agent count and recent sessions stay current. Selecting
a recent session restores the existing renderer and opens the same guarded
resume-confirmation workflow used inside the app.

## Appearance and managed backgrounds

General settings schema version 6 stores theme and background presentation
preferences. The renderer applies the explicit `lumora`, `light`, or `dark`
selection through semantic color tokens, with `lumora` as the default mixed
dark-sidebar and light-workspace palette. Version 5 settings migrate without
discarding appearance values, add a zero-strength Surface mosaic, and normalize
temporary pre-release `system` selections to `lumora`. Xterm
palettes update on existing terminal instances, so a
theme change does not recreate a PTY, discard scrollback, or interrupt an
agent. A separate preference keeps terminals dark in Light mode by default.

Custom background selection remains privileged. The main process accepts only
PNG, JPEG, and WebP selections from a native file dialog, rejects empty or
oversized inputs, bounds the longest image edge, converts the result to PNG,
and stores the managed copy under the application's user-data directory. The
original source is never modified.

The preload bridge exposes only availability, an opaque cache revision, and
choose/remove operations. Renderer image loading uses the exact
`app://appearance/background` protocol route; arbitrary paths and other hosts
are rejected. Surface and terminal transparency are applied only while a valid
managed background is enabled, preserving fully opaque defaults otherwise.
Surface mosaic is scoped to the app shell and adds its backdrop-filter class
only for positive values; the zero default creates no mosaic layer.
Surface and terminal opacity accept the full zero-to-one range. Xterm runs with
transparent rendering enabled over a DOM-owned terminal tint, so changing
terminal opacity exposes the managed background without fading terminal text,
recreating the terminal, or interrupting the PTY. In-app dialog backdrops,
dialog shells, and the runtime switcher share the surface and mosaic controls.
The renderer derives recessed, normal, raised, popup, and popup-raised opacity
tiers from the selected surface opacity, then applies them through centralized
semantic background tokens. Popup tiers retain a readability floor even when
normal surfaces are set to zero. On terminal routes, the outer workspace frame
is transparent so the workspace, terminal chrome, and DOM-owned terminal tint
do not compound into an unintended opaque stack.

## Intentional future scope

### Selectable runtime icon appearance

Lumora may let users choose between its transparent and dark icon styles. This
is intentionally limited to runtime surfaces that Electron can update reliably:
the window and taskbar icon on Windows and Linux, and the Dock icon on macOS.
The preference would be stored in General settings, applied on launch, and
default to the transparent style.

Packaged and operating-system-managed icons remain outside this preference.
The Windows executable, installer, and shortcuts; the macOS application bundle;
and Linux desktop launchers use icons selected during packaging and may also be
cached by the operating system. Lumora should keep those surfaces transparent
rather than rewriting installed files or publishing separate icon-style builds.
The setting must therefore be presented as a runtime icon appearance choice,
not as a promise to replace every installed application icon.

### Read-only session preview

Lumora may add a Session Details view that lets users identify a saved session
before resuming it. The handoff adapters now provide bounded provider-specific
parsing, but an interactive preview still needs a separate on-demand contract,
redaction policy, renderer view, and non-persistent cache lifecycle.

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
| `src/main/appearance/` | Validated managed custom-background lifecycle |
| `src/main/providers/` | Provider discovery and session-source adapters |
| `src/main/handoff/` | Temporary cross-agent context lifecycle and cleanup |
| `src/main/terminal/` | Launch resolution, PTY runtime, recovery, reconciliation |
| `src/main/remote/` | SSH targets, platform probing, helper install and protocol lifecycle |
| `src/main/storage/` | SQLite migrations and repositories |
| `src/main/ipc/` | Validated privileged IPC handlers |
| `src/preload/` | Typed renderer bridge |
| `src/renderer/src/catalog/` | Home, workspace, and session views |
| `src/renderer/src/terminal/` | Terminal workspace and xterm integration |
| `src/renderer/src/settings/` | Categorized application settings |
| `src/shared/` | Contracts and provider definitions shared across processes |
