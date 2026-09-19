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
- a restrictive content security policy;
- every web permission refused — microphone, camera, location, notifications,
  clipboard and device access — on the default session and on any session
  created later. The clipboard goes through the main process instead.

The renderer keeps active terminal components mounted while application routes
change. This preserves PTY attachments and avoids recreating terminal views on
ordinary navigation.

Pages scroll inside `.main-content` under a fixed top bar. A page marks its
toolbar with `page-toolbar`, which is sticky and pinned `--page-toolbar-inset`
under the top bar. Chromium pins a sticky box inside its scroller's padding, so
the offset subtracts the page gutter. Its layer sits above every layer page
content uses, such as a hovered workspace card, and below the overlays, which
start at 70; a contract test holds both. The toolbar is a `scroll-state` container,
and its `::before` backing shows only under `scroll-state(stuck: top)`. The
backing is painted as the top bar is seen: the top bar surface over the page
surface, since the top bar surface alone is translucent. Two `box-shadow`
spreads, clipped to its height, carry it to both page edges whatever card holds
the toolbar, without adding scrollable overflow. Over a background picture it
blurs what passes beneath. A toolbar that scrolls sideways, such as the Settings
tabs, is pinned through a wrapper, since its own overflow would clip the
backing. The page title fades on a `view(block 0px)` timeline, since a bare
`view()` would take any scroll padding of the page and fade the title at rest.
The page has no scroll padding: with it, a control focused inside the pinned
toolbar counts as hidden behind it, so the search shortcut, Tab and the Settings
arrow keys scrolled the page. A focused row needs none, since Chromium brings it
toward the middle of the page. Another Settings category, a new search or a
new provider filter keeps the page where it is, and `keepPageToolbarPinned`
moves a page whose toolbar is pinned to where it first pins, so the new content
starts right under it. Settings is at least as tall as the page plus the
distance the toolbar lifts, so even a short category can keep its categories
pinned. `usePageTitleAway` watches the
title with an `IntersectionObserver` and swaps the top bar text for the page
name once a quarter of it or less shows. The docked Changes panel measures the
pinned toolbar and docks 12px under it.

A renderer-root tooltip provider owns one portal-based hover surface. Tooltip
placement is clamped to the viewport, uses semantic appearance tokens, and
supports delayed pointer intent, deliberate keyboard focus, shortcut labels,
and overflow-only disclosure. The bubble is measured with the whole viewport
free before it is placed, so a long label is never wrapped by wherever the
previous bubble stood, and an open bubble takes new content in place: an icon
button that starts or finishes its work while hovered says so without its
tooltip closing. Renderer JSX is contract-tested to reject native `title`
attributes so browser-owned hover bubbles cannot silently return, and icon
buttons that draw a refresh, update or install mark are contract-tested to
declare a busy state and the text their tooltip shows while it runs.

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
its structured export command. Large JSONL snapshots are normalized as a stream
with bounded records, messages, activities, and provider correlation state;
the complete source is never retained in process memory. This operation is
separate from catalog scans and runs only for a user-confirmed cross-agent
launch.

## Structured agent runtime

Lumora's local Unified UI is an additional provider interaction route, not a
replacement session model. Codex app-server and Claude Agent SDK have dedicated
adapters. Gemini CLI, OpenCode, Cursor CLI, GitHub Copilot CLI, Qwen Code, Kimi
Code, and goose use provider-owned ACP servers through a shared profiled
adapter. Every adapter translates provider events into strict shared contracts
while the provider continues to own authentication, sessions, tools,
permissions, and model behavior.

An ACP provider is eligible only after its exact executable invocation returns
a valid protocol-version-1 initialization response. The registry owns the
provider-to-integration mapping and the ACP profile owns its argument vector and
authentication policy. Cursor CLI and goose can open new structured sessions,
but their launch-only catalog support means Lumora does not invent saved-session
discovery for them. A failed handshake or structured startup leaves the native
PTY route available.

```text
catalog session or new launch
          |
 expiring prepared-launch token + workspace trust
          |
 target master gate + provider capability report + user preference
        /   \
 verified   unavailable / disabled / failed
    |                    |
structured runtime   native PTY runtime
    |
sequenced, bounded normalized events
    |
sandboxed Unified UI
```

The launch router consumes each prepared launch once and treats the target-scoped
Unified UI master setting as an authoritative gate before running capability
probes. A disabled automatic route goes directly to PTY, while an explicitly
requested Unified UI route fails closed. When enabled, it selects the structured
route only for an advertised new or resume capability. A prepared launch can
also carry an explicit local route selected from a session context menu:
`unified` requires the verified capability and never silently falls back,
whereas `pty` bypasses structured probing for that launch without changing the
stored provider preference. Native forks, cross-agent handoffs, PTY-only
providers, and unhealthy automatic routes use the PTY.
If structured startup fails before the runtime owns the session, Lumora uses
the already validated PTY specification. An ownership collision is never
converted into a fallback because doing so would bypass the one-writer guard.
Each direct launch also carries a renderer-created operation identity. The
main-process router owns its cancellation signal until startup settles. Closing
the launch surface cancels that operation; a structured adapter is closed while
it opens, and a PTY that resolves after cancellation is immediately terminated.
Cancellation never becomes a structured-start failure or triggers PTY fallback.
Normal page navigation only hides the launch surface and does not cancel it.

A launch checks only the providers it uses. Preparing and consuming it read
that provider's installation, and a handoff source's, from what discovery last
found instead of scanning every provider. An answer past its five-minute term
is refreshed in the background, and only a provider with no ready answer (never
found, last probe failed, or reported broken) is probed at once, on its own.
When the stored answer would refuse the launch, those providers are asked again
before it is refused. The capability probe likewise asks only the launched
provider. A verified report is kept while that provider's executable path and
version are unchanged, because either change is a new cache key; a failed or
timed-out report is retried after 30 seconds. A structured launch failure other
than a cancellation or an ownership collision forgets that provider's report
and installation. A full scan keeps its five-minute term, but when one version
check failed only that provider is rescanned ten seconds later. A failed version
check is retried once, and the diagnostic journal records which provider failed
and whether it timed out. Twenty seconds after startup, the providers opened in
Unified UI during the last 14 days, at most three and most recent first, are
checked in the background one at a time; that record holds only provider IDs
and times.

The main-process runtime host owns provider processes, cancellation, cleanup,
reconnection, event sequencing, and session reconciliation. The renderer sees
only validated summaries and bounded normalized events. It never receives a
provider SDK, process handle, raw filesystem capability, or general-purpose RPC
transport. Runtime identity is indexed with PTY identity so direct resume
activates an existing owner instead of launching a duplicate.

A message sent while a turn runs is delivered according to the session's
`canSteer` capability. Codex reports it: the adapter sends `turn/steer` with the
active turn as `expectedTurnId`, and if the turn ended in the meantime it starts
the next turn with the message instead of dropping it — waiting briefly for
the end of the turn, because Codex can refuse the steer before it reports that
end. A review or compaction turn cannot be steered; the adapter marks the turn
it started for one as `steerable: false`, and the renderer queues instead. The
resulting
`user.message` carries `followUp: true`, which the renderer shows beneath the
turn's prompt; an unflagged message still restates the prompt, so Codex's live
echo of a user item cannot duplicate one. The adapter also skips that echo for
turns whose message it has already shown, and marks a turn's later user items
as follow-ups when it reads history. For agents without the capability the
renderer holds the message in a per-session queue and sends the first waiting
message once the latest turn is no longer running, at most one per finished
turn, so no provider ever receives a prompt while another is in flight. A
queued message whose send fails is marked and left for the user rather than
retried, so a persistent failure cannot become a loop.

Modes use the same command channel as models rather than a separate action. An
adapter that can change how its agent works publishes a command with the id
`mode`, its choices, and the current value, and the renderer shows it as a
picker beside the model's. Codex maps it to its collaboration mode (`default` or
`plan`) through `thread/settings/update`; Claude maps it to the Agent SDK's
permission mode through `setPermissionMode`, offering only the modes Claude Code
cycles through and never switching into `bypassPermissions`; ACP agents map it
to a mode-category session config option or to `session/set_mode`. Each adapter
republishes the command when the agent reports a mode change of its own —
Codex's settings update, Claude's status message, or ACP's `current_mode_update`
— so the picker never shows a mode the session has left.

Mode and model are settings rather than work asked of the agent, so both are
sent while a turn runs; every other command still waits for the turn to end.
Each provider takes them on a channel that is not the prompt: Codex's
`thread/settings/update`, Claude's control requests, ACP's session methods. An
adapter that records the command in the conversation adds it to the turn under
way instead of opening one of its own, since a turn arriving after the running
one would read to the renderer as the agent falling idle.

Agent errors travel as `runtime.error` events that say what went wrong in
shared terms. Each adapter maps its provider's own names — Codex's
`codexErrorInfo`, Claude's API error names, or an HTTP status when that is all
there is — to one error kind: usage limit, rate limit, full context, overload,
connection, sign-in, account, refusal, or other. The event keeps the provider's
words separately from Lumora's fallback message, so the renderer can say the
kind in the user's language and add the provider's detail without inventing
untranslated text, and it can carry the retry attempt and a limit's reset time.
The renderer keeps an error with the turn it came from and drops it once events
show the agent recovered: that turn completing, output in it after a failure the
provider was retrying, or output in any later turn. A turn merely starting does
not count, because a command's reply opens and closes a turn of its own without
the agent speaking. Codex's
rolling `account/rateLimits/updated` notifications carry no thread, so they are
read before the per-thread filter and merged into the last snapshot, keeping any
value an update leaves out, as the protocol asks.

Requests an agent sends to Lumora mid-turn are answered, not refused. Codex's
user-input request, Claude's AskUserQuestion tool, and MCP elicitation from
either become one `question.requested` event: a list of questions, each a
choice, free text, a number, or yes or no, or a page to visit. The renderer
answers with a `question.respond` action, and the adapter writes the answer
in the protocol's own shape — keyed by Codex question id, by Claude question
text, or typed to the MCP form's schema, which is checked before the question
is released. The answer travels in the action only; the event stream records
`question.resolved` with an outcome, so an answer never enters session
history. A question is settled as cancelled when its turn ends, when the
provider withdraws it, or when the session closes. Codex permission requests
reuse the approval events and grant back exactly the requested profile.
Dynamic tool calls, ChatGPT token refresh, and attestation belong to clients
that register for them, and Lumora still refuses them.

Image input keeps the same boundary. The renderer decodes a pasted, dropped, or
picked image, bounds its longest edge, and re-encodes it as PNG or JPEG. The
main process then:

- checks the file signature;
- decodes it again with `nativeImage`;
- enforces the per-image and per-session limits;
- writes it with owner-only permissions under a per-connection temporary
  directory.

The renderer gets back an opaque token, and the prompt carries that token rather
than a path. The runtime host resolves a token only for the connection that
staged it. Each adapter then turns it into its provider's own input:

- a `localImage` path for Codex;
- base64 image blocks for the Claude Agent SDK;
- ACP image blocks, when the agent advertises `promptCapabilities.image`.

Staging is refused for a session that did not report image support. A
connection's directory is removed when its runtime closes. Directories an
earlier run left behind are removed at startup once they are stale.

Files take the opposite route, because agents already read files. The main
process owns the file dialog and returns only what the user picked, and a
dropped file is resolved to its path through the preload bridge; the renderer
puts those paths in the message text. Nothing is copied, staged, or read by
Lumora, no capability is granted by the path itself, and the agent's own
workspace rules decide whether it can open the file.

Conversation state is bounded for presentation. The renderer initially shows
at most five recent turns within a render budget and loads older pages on
upward scroll. This limits initial DOM and Markdown work without deleting or
rewriting provider history. Process details are collapsed by default, file
changes use display-only normalized diffs, and session/account usage is loaded
through a separate details surface.

Remote Lumora remains PTY-routed in 0.5. Remote session discovery, trust,
launch settings, and SSH runtime isolation keep their existing target-scoped
boundaries; local structured capability reports are not reused remotely.

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
after a managed provider exits. A terminal launch that must find the session it
creates refreshes only its own provider's sessions; a full refresh already
under way answers for it, and refreshes of different providers run together. Search results use request ownership so a slow,
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

A terminal started for a new session, a native fork, or a handoff has no
session identity until the provider writes one. Just before the terminal
spawns, Lumora refreshes that provider's sessions alone and records the IDs
already present in the workspace; reconciliation then refreshes the same
provider on its schedule and links the one ID that was not there before. The
other providers keep what the last catalog refresh found. A Unified UI launch
hears its session ID from the agent, so it neither waits for this refresh nor
reconciles. If the sessions cannot be read, the terminal still starts and is
left unlinked.

For an enabled cross-agent handoff, the main process instead:

1. verifies that source and destination providers are enabled, installed,
   compatible, and have complete session support;
2. reserves an immutable launch plan while showing the normal launch preview;
3. after workspace trust and final confirmation, copies the source into a new
   Lumora-managed handoff directory;
4. normalizes ordered user and assistant messages plus a compact, safe tool
   activity ledger into bounded Markdown files, retaining opening and recent
   context with explicit partial-coverage warnings when a large history must be
   condensed; and
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

## Workspace changes

A local session records what changed in its workspace while it ran. The
snapshot engine in `src/main/changes/` takes that record with git, without
writing to the workspace; reading a copied split index can refresh the timestamp
of the repository's shared index file, and that is the only mark it leaves. Every workspace has a private store under `userData`
in `workspace-changes/<workspace id>`. `GIT_OBJECT_DIRECTORY` points at that
store's object directory and the repository's own objects are added through
`GIT_ALTERNATE_OBJECT_DIRECTORIES`, so new blobs and trees are written beside
Lumora's database and never into the project. `GIT_INDEX_FILE` points at a copy
of the repository index inside the store, which keeps git's stat cache and with
it the speed of a snapshot. A split index is disabled so git cannot leave shared
index files in the repository, and Git LFS storage is redirected into the store
so a clean filter writes its objects there while the tree still carries the
pointers a commit would. A workspace that is not a repository is snapshotted
against a bare shadow repository in the same store, using a default exclude list
for dependency and build directories. Git is run only from an absolute resolved
path and never from the name `git`, which a working directory could otherwise
supply on Windows; each run also drops inherited `GIT_*` variables, disables
optional locks and background maintenance, and is bounded by a timeout and an
output limit.

Migration 22 adds `workspace_change_segment` and `workspace_change_review`. A
segment belongs to one execution target, workspace, and session owner, and holds
the baseline tree and head, whether that baseline arrived late, and the state:
`capturing`, `ready`, or `unavailable` with a reason of `git-missing`,
`workspace-unavailable`, `too-large`, or `failed`. A review records the two
trees a reviewed batch moved between and how many files it covered. Marking
files reviewed composes a new tree from the baseline plus the reviewed paths and
moves the segment's baseline onto it in the same transaction that inserts the
review, guarded by the tree it started from, so a stale review cannot overwrite
a newer one. None of this reaches the workspace or its repository.

A session's baseline races a bounded launch wait of three seconds. The session
is released as soon as the snapshot is recorded or the wait expires, whichever
comes first, and looking for git counts toward that wait. A snapshot that lands
after the wait marks the segment late, and the panel says that tracking started
after the agent began. Change tracking never keeps a session from starting: a
failure becomes an unavailable reason and a throttled diagnostic event carrying
a reason code, never a path or git output.

A count is recomputed when a Unified UI turn ends, when a session ends however
it ended, and on a 30-second timer for open native-terminal sessions, which
leaves out Unified UI sessions because their turns already report. The panel's
own refresh re-reads the summary instead. Recomputation is coalesced per
session, one snapshot is shared between views for two seconds, and each result
is pushed to the main window as one count event.

Six invoke channels carry the feature, `lumora:changes:` with `summary:get`,
`file-diff:get`, `review:mark`, `history:get`, `file:open`, and `counts:get`,
plus the `lumora:changes:count:event` push. All of them use the local-only
authorizer: a sender must be a trusted renderer frame with a registered window
context in local mode on the local execution target, so a remote target window
is refused before any handler runs. A sender that fails the authorizer is
rejected before the handler body; every other failure crosses the boundary as
one generic error. The renderer does not offer the feature there at all: a remote
window renders the session and workspace views without the changes API, so no
button appears.

Opening a changed file is deliberately narrow. The path is resolved inside the
workspace both lexically and through `realpath`, and anything that leaves it is
refused, including a link inside the workspace that points out of it. What opening may
do is then sorted into three. Executables, installers, shortcuts, loadable
extensions, and every other `PATHEXT` entry on Windows are only ever revealed in
their folder, as is any file carrying an execute bit on macOS and Linux, and so
is a file whose mode cannot be read. Scripts people also read, such as `.py`,
`.sh`, `.ps1`, and `.vbs`, answer `confirm-required`, and the renderer asks
before calling again with `open-anyway`; that answer is honoured for this class
alone. Everything else opens. The name is judged twice, on the path the renderer
asked for and on the path it really leads to, and the stricter answer wins; only
the execute bit is read from the real file.

Snapshots live only as long as the history that refers to them. Startup runs
before any session launches: it ends segments the previous run left open, prunes
segments that ended more than 14 days ago together with their reviews, and
removes the store of a workspace that has no segments left. Remote targets are
outside this feature; they keep the PTY view without change tracking.

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
of recent structured events and, through a separate call that does not read the
journal, a resource sample: bounded Electron process metrics for Lumora itself
and the current count of locally managed launching or running agents. The
memory value sums each Electron process's resident working set, so shared pages
may be represented more than once. Electron measures CPU since its previous
metrics call, so the service reports CPU only when that call was between 250 ms
and 5 seconds earlier and reports none otherwise. The renderer samples one at a
time while Diagnostics is open and the window is visible: every two seconds, or
after one second when the last sample had no CPU reading. Agent processes are
not part of Electron's metrics. Every metrics call restarts Electron's CPU
measurement for all callers, so a call made within 250 ms of another shares its
reading rather than cutting the next one short.

Process details come from a third call. Lumora starts its packaged helper on
this computer, after verifying it against the bundle manifest, only when
details are requested, and the helper exits once 15 seconds pass without a
request; a helper that fails is not started again for 30 seconds. The helper's
`process-tree` operation lists a root process and everything under it, up to
256 processes, with parent, executable name, working set, total CPU time, and
start time, and never a command line. It reads a process snapshot and process
times through Windows system calls, `/proc` on Linux, and `ps` on macOS, and
drops a child that started before its parent, whose parent ID was reused. The
service samples the tree under Lumora's main process and assigns each running
agent the subtree under the process Lumora started for it: the pty process for
a terminal session, the spawned transport for Codex and ACP sessions, and for
Claude Code the process Lumora starts on the SDK's behalf through
`spawnClaudeCodeProcess`, which drains Claude's error output so an unread pipe
cannot stall it. An agent outside Lumora's tree is sampled on its own. What
remains is Lumora's; Electron's own processes keep Electron's labels and
figures and are listed even when the helper is unavailable. Helper CPU is the
change in CPU time between samples, keyed by PID and start time. Titles and
process names reach only the renderer and never an export.

The export bundle, schema version 2, carries the summary and a resource sample
side by side. Export is an explicit native save-dialog
action that creates a local JSON file. Its last successful parent directory is
remembered privately and used as the next dialog location. Native directory
dialogs prevent the renderer from submitting arbitrary paths. There is no
diagnostic upload or native crash-dump collection.

## Localization and Mods

Lumora packages immutable built-in locale catalogs with the application. On
first use, the main process resolves a supported operating-system locale and
falls back to bundled English; a later explicit language choice is global to
local and Remote Lumora windows and native application surfaces.

User language packs, font presets, and theme packs are data-only Mods. The
active Mods root defaults to a directory under `userData`, while a private preference can point
to another writable local directory. Changing that preference does not move or
delete content. The former per-user `locales` directory remains a compatibility
source. Catalog precedence is the active Mods pack, the legacy user pack, the
matching bundled locale, and finally immutable bundled English.

Font presets are bounded JSON records under the active Mods root's `fonts`
directory. They contain installed font-family names only; Lumora does not load
font binaries or executable extension code. The loader sorts candidates
deterministically, rejects links, non-regular files, oversized data, filename
mismatches, and invalid schemas, and isolates rejected presets from healthy
ones. The renderer combines a selected font with an immutable interface or
terminal fallback stack.

Theme packs are bounded JSON records under the active Mods root's `themes`
directory. They provide a fixed semantic palette and light-or-dark base theme;
they cannot target arbitrary selectors or execute code. The main process
rejects links, malformed schemas, unsafe identifiers, filename mismatches,
oversized files, and palettes that fail required text-contrast checks. The
renderer maps accepted semantic colors onto Lumora's existing appearance
tokens, while provider-owned terminal output remains outside the pack.

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

## Sidebar session projection

Local and remote renderers derive sidebar sessions from their target-scoped
catalog and live runtime state. Launching and running runtimes form the
**Running sessions** list. Catalog sessions linked to those runtimes are
excluded from **Recent sessions**, which remains ordered by provider update
time and renders progressively in bounded batches. Selecting a running item
activates its existing mounted terminal; selecting a recent item enters the
same guarded resume flow used by session cards.

The expanded sidebar reserves at most 70% of its session region for running
items and at least 30% for recent items when both lists exist. Each list owns
its scroll state and stores its expanded preference under a local or
target-specific key. Runtime exit notifications update both projections. The
terminal tab strip is presentation-only hidden while the sidebar is expanded;
terminal components and PTY attachments stay mounted.

## Session status cues

A session you are not watching can finish, fail or wait on you. The renderer
keeps one **outcome** per open session and turns a new one into cues: a dot on
its sidebar tile and tab, a tip, and an optional chime, each behind its own
General setting. A session is **watched** while it is in front of a focused
window; watching clears its dot. The same slot shows a spinner while a
session's agent is **working**, for every session: it is state rather than
news. `sessionIndicator` gives the slot one thing at a time: an unseen request
for you, then working, then an unseen finish or failure.

- **Outcomes.** A Unified UI session's outcome comes from its events, read from
  the last turn boundary on: `turn.completed` finished or failed,
  `approval.requested` and `question.requested` until settled, and nothing while
  a turn runs or after a cancelled one; it is working while a turn runs that
  waits on no one. A terminal's outcome arrives as a runtime `outcome` event
  from main, and its working state as an `activity` event, emitted only when
  it changes. Each outcome carries a key, the event it came from, so the same
  outcome read twice is not news.
- **Tracker.** A session read for the first time is taken as seen whatever it
  shows, since a resumed session arrives with its history. After that a new key
  is news unless the session is watched; a newer outcome replaces an older one,
  so a session carries one dot at most.
- **Terminal output.** `RuntimeHost` scans every PTY chunk, on screen or not, for
  a bare BEL or an `OSC 9` / `OSC 777;notify` notification. A BEL that ends an
  OSC string is its ending; `OSC 9;<number>` is ConEmu's family of codes, which
  Windows Terminal uses for progress and shells for the working directory. The
  scanner keeps its place across chunks. The same outcome within two seconds is
  one moment and is dropped.
- **Launch hooks.** For a local Claude Code or Codex terminal started from the
  detected executable, `SessionStatusHooks` adds arguments before spawning:
  Claude Code gets `--settings <file>` with `UserPromptSubmit`, `Stop` and
  `Notification` hooks. The prompt hook marks the runtime working and starts
  the repeat guard over, so a quick next turn still counts; the helper prints
  nothing there, since Claude Code adds a prompt hook's output to the prompt.
  Codex gets `-c features.hooks=true` and `hooks.<Event>` for
  `UserPromptSubmit`, `Stop`, `PermissionRequest` and `Interrupt`, which Codex
  merges with the person's own hooks and runs through `cmd.exe /C` or
  `/bin/sh -lc` once they are trusted in `/hooks`; the command is the same for
  every launch, so trust lasts. It also gets `-c notify=[…]`, which reports a
  finished turn before the hooks are trusted. Every value is in TOML literal
  strings, which Windows PowerShell passes to a native program intact. Codex's
  `notify` override replaces the person's own, so theirs is read from
  `config.toml` and passed on to be run too; when it cannot be read for certain
  it is left alone. Codex gives hooks a snapshot of the environment that drops
  names like `*TOKEN*`, so the per-runtime value travels as
  `LUMORA_STATUS_ID`. The hooks run `lumora-helper notify --event <name>`,
  which writes one line — a per-runtime token and the event name — to a named
  pipe on Windows or an owner-only unix socket elsewhere, and always exits
  successfully. Codex's payload, which holds conversation text, is passed to
  the person's program and never read. Main hears only live tokens. Once a hook
  has said the agent needs you, its bell is redundant; until then the bell
  still speaks for what the hooks do not, which covers hooks not yet trusted,
  apart from a bell right after a hook, which is the same moment. `Interrupt`
  stops the spinner without a cue. Hooks are taken down with the runtime, and a
  failure to prepare them never stops a launch.

The dot takes the theme's `--blue`, `--warning` and `--danger`, which a custom
theme sets from its palette; a style contract keeps literal colours out of its
rules.

## Settings search

Search in Settings filters the real controls in place. No registry lists the
settings: each row carries markers and `SettingsView` matches them in one pass
over the rendered page (`src/renderer/src/settings/settings-search.ts`).

- **Markers.** `data-setting` holds a row's label key, which also finds its
  English text, and `data-setting-description` its description key.
  `data-setting-modified` marks a value that differs from its `DEFAULT_*`
  setting. `data-setting-group` holds a group's title key, so a search for the
  title finds every row in it. `SettingBlock` wraps the separate parts of one
  setting in a `display: contents` box so they match and count as one, and
  `data-setting-companion` keeps something like a Save button with its panel's
  results.
- **Matching.** Every word must appear in a row's text: what it renders, the
  values of its text fields, its translated and English label and
  description, and its group title. The English text comes from the English
  packs bundled for search, since the renderer receives only the active
  language. A term with `+` also compares without spaces or `+`, so `ctrl+f`
  finds `Ctrl + F`. `@modified` keeps only marked rows and stays in step with
  the Modified toggle.
- **Hiding.** The pass sets `data-search-miss`, which React never renders, on
  rows that miss, and counts matches by category for the tabs. The stylesheet
  does the rest: while searching, anything in a category that is not a
  setting, a companion or an alert and holds no match is hidden, and a
  category with no match stays hidden. A `MutationObserver` matches rows that
  load or change while a search is on.
- **Panels that load on request.** A search activates Appearance, Mods and
  Transfer so their rows exist, opens every collapsed Appearance section
  through `SettingsSearchingContext`, and loads only Diagnostics' storage
  rows, leaving its live sampling to the tab. About is not woken, since it
  checks for releases.

## Appearance and managed backgrounds

General settings schema version 12 stores built-in or data-only Mod theme
selection, background presentation, and independent interface and terminal
font preferences. The renderer applies the
explicit `lumora`, `light`, or `dark`
selection through semantic color tokens, with `lumora` as the default mixed
dark-sidebar and light-workspace palette. Version 5 settings migrate without
discarding appearance values, add a zero-strength Surface mosaic, and normalize
temporary pre-release `system` selections to `lumora`. Xterm
palettes update on existing terminal instances, so a
theme change does not recreate a PTY, discard scrollback, or interrupt an
agent. A separate preference keeps terminals dark in Light mode by default.
Installed-font choices are represented as validated family names, quoted before
presentation, and always followed by cross-platform fallback stacks. Xterm font
changes update and refit the existing instance without remounting it or
reattaching the PTY. Remote windows use the same global appearance settings and
resolve fonts on the local renderer computer rather than the SSH target.

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
They can only because every portal renders into the app shell, which is the
appearance root: the opacity tiers are tokens on that element, and a dialog
portalled to the document body would resolve the opaque defaults instead. A
contract test fails the build when a portal reaches the body other than as the
fallback for a window without a shell.
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
| `src/main/status/` | Launch hooks that let an agent report it finished or needs you |
| `src/main/changes/` | Workspace snapshots, change segments, and reviews |
| `src/main/remote/` | SSH targets, platform probing, helper install and protocol lifecycle |
| `src/main/storage/` | SQLite migrations and repositories |
| `src/main/ipc/` | Validated privileged IPC handlers |
| `src/preload/` | Typed renderer bridge |
| `src/renderer/src/catalog/` | Home, workspace, and session views |
| `src/renderer/src/terminal/` | Terminal workspace and xterm integration |
| `src/renderer/src/changes/` | Docked changes panel, diffs, and review history |
| `src/renderer/src/status/` | Session outcomes, the dot, the tip, and the chime |
| `src/renderer/src/settings/` | Categorized application settings |
| `src/shared/` | Contracts and provider definitions shared across processes |
