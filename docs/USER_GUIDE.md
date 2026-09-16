# Using Lumora

Lumora is a local-first desktop workspace for installed AI-agent command-line
tools. It discovers provider-owned sessions, groups them by workspace, and
runs agents in either Lumora's local Unified UI or a managed native terminal.
The provider continues to own authentication, session files, permissions, and
usage limits.

For installation and system requirements, start with the
[README](../README.md#get-lumora).

## First run

1. Open **Settings > Environment** and confirm Node.js and npm are available.
2. Open **Settings > Providers**, switch on the agents you want Lumora to scan,
   and review their detected versions. **Details** on a card shows where the
   provider was found and lets you set its start command.
3. Install or authenticate each provider using its supported Lumora action or
   official instructions.
4. Open **Workspaces**, add a project directory, then select **New session**.
5. Choose a provider and terminal profile, review the effective launch, and
   confirm trust for the exact workspace path.

Every provider is optional. A missing or incompatible provider does not stop
healthy providers from working.

## Home and the sidebar

Home summarizes running agents, recent provider-owned sessions, catalog
health, and provider updates that need attention.

**Needs attention** reports one count. **View details** beside it opens a
dialog listing each catalog issue with what it affects and how to clear it,
and every lost runtime with its recovery action.

<p align="center">
  <img src="screenshots/0.5/core/home.png" alt="Lumora 0.5 Home with running and recent sessions in the expanded sidebar" width="1100">
</p>

The expanded sidebar keeps **Running sessions** separate from **Recent
sessions**. Running sessions open their existing Lumora runtime. Recent
sessions use the normal resume route. Each list can be collapsed independently
and refreshes when a managed runtime exits. The recent list loads progressively
as it scrolls.

A session counts as running whether it runs in a native terminal or in the
Unified UI, and it appears as soon as it starts rather than once the provider
finishes connecting. The same total is shown by **Running agents** on Home, the
status bar, the tray menu, and **Active agents** in Diagnostics.

Collapse the main sidebar to keep only navigation icons. Session lists then
disappear and the terminal tab strip becomes the primary session switcher.
Lumora remembers the sidebar state across application launches.

## Workspaces

The Workspaces page groups provider-owned sessions by project directory.
Search filters the visible cards without changing the catalog.

<p align="center">
  <img src="screenshots/0.5/core/workspaces.png" alt="Lumora Workspaces page with search and provider-owned workspace cards" width="1100">
</p>

Select a workspace card to open its session list. Starting a new session from
that page preselects the current workspace.

<p align="center">
  <img src="screenshots/0.5/core/workspaces_sessions.png" alt="A Lumora workspace detail page showing its saved sessions" width="1100">
</p>

To remove an old project from everyday navigation without deleting it, choose
**Hide workspace** from the workspace actions. You can hide only the workspace
card while retaining its sessions, or hide the workspace and its sessions.
Use **Hidden workspaces** to search, select, and restore hidden entries.

Lumora never deletes the project directory or provider-owned session data when
a workspace is hidden.

## Saved sessions

All Sessions searches across titles and workspaces and filters by installed,
enabled providers for which Lumora found sessions. Token totals appear when a
provider exposes reliable all-time usage metadata.

Session names and workspaces are owned by the provider, so renaming a session
inside the provider is reflected in Lumora on the next catalog refresh. A
session stays grouped under the workspace it started in even when the agent
later works in other folders, such as a git worktree or a subdirectory, because
that is the workspace the provider resumes it from.

<p align="center">
  <img src="screenshots/0.5/core/all_sessions.png" alt="Lumora All Sessions with search, provider filtering, running state, and token usage" width="1100">
</p>

Select a stopped session to resume it directly. Lumora:

- returns to the existing runtime when that provider session is already
  running in Lumora;
- uses the verified local Unified UI when it is enabled for the provider; or
- resumes through a managed native terminal when Unified UI is unavailable or
  disabled.

Right-click a stopped session to choose an explicit route. **Open in native
terminal** affects that launch only and does not overwrite the saved Unified UI
preference. **Resume options…** opens the advanced workflow for provider-native
fork, cross-agent handoff, an initial task, or one-time launch overrides.

<p align="center">
  <img src="screenshots/0.5/core/session_context_menu.png" alt="Lumora session context menu with Unified UI, native terminal, and advanced resume choices" width="760">
</p>

Codex, Claude Code, and OpenCode support provider-native forks when the
installed version meets Lumora's tested minimum. Cross-agent handoff is a
separate opt-in workflow: it creates a new destination-provider session from a
temporary managed copy and leaves the source session unchanged. For a large
file-backed history, Lumora retains bounded opening and recent conversation
context and reports when older content was condensed.

See [Provider support and verification](PROVIDER_SUPPORT.md) for the exact
capability matrix and [Move sessions between devices](SESSION_TRANSFER.md) for
export and import.

## Start a new session

Select **New session**, then choose a workspace, enabled provider, and terminal
profile. An initial task is optional. A blank task sends nothing to the agent.

The launch preview shows the effective command, working directory, terminal,
and the layer that supplied each value. Lumora resolves settings in this order:

```text
Global < Provider < Workspace < Session < One-time launch
```

Custom commands, aliases, and wrappers work when the selected terminal profile
can resolve them. Lumora asks for workspace trust before the Start action is
available unless **Settings > Security > Automatically trust workspaces** has
been explicitly enabled and confirmed.

## Unified UI

Lumora 0.5 offers a local chat-style interface for verified structured
provider integrations. It supports streamed Markdown, provider commands and
models, tool activity, approvals, file changes, cancellation, progressive
history, and session details when the provider exposes them. A message can
carry images and point the agent at files on disk. You can answer an agent's
questions, switch how it works with the **Mode** picker, and keep writing
while it works: a message goes into the running turn or waits for it to end,
depending on the agent.

See the complete [Unified UI guide](UNIFIED_UI.md).

## Managed native terminals

Native provider TUIs run in managed PTYs and stay mounted while you navigate
between Lumora pages. With the sidebar expanded, select the session under
**Running sessions**. With it collapsed, use the terminal tabs or the configured
terminal-switcher shortcut.

Set the terminal text size under **Settings → Appearance**, beside the terminal
font. It applies to terminals that are already open, local and remote, without
reopening them. A larger size leaves fewer columns, so a wide provider interface
wraps sooner.

When the provider exits, Lumora closes the runtime view and refreshes the
catalog and sidebar. Stopping a session uses a graceful provider-aware shutdown
before forceful termination. A full Lumora exit also warns before stopping
active local or remote agents when the corresponding General settings are
enabled.

### Clipboard and interrupts

- **Windows and Linux:** `Ctrl+V` pastes. `Ctrl+Shift+C` and `Ctrl+Shift+V`
  always copy and paste. `Ctrl+C` copies selected text. Right-click pastes text
  or a supported clipboard image into a live terminal.
- **macOS:** `Command+C` copies and `Command+V` pastes. Right-click also pastes.
- With no selection, the first `Ctrl+C` arms an interrupt and the second press
  stops the managed runtime, reducing accidental interruption.

Provider-native shortcuts are forwarded except for configured Lumora
shortcuts. Codex `Shift+Enter` multiline input remains a known embedded-terminal
limitation; see [Troubleshooting](TROUBLESHOOTING.md#codex-shiftenter-does-not-create-a-new-line).

## Review changes

Each local session header carries a **Changes** button that counts the files
changed in that session's workspace since the session started, so **Changes 12**
means twelve files. Every session counts its own, and a session tab that is not
in front adds the same total to its line as **· 12 changed**. The workspace
page has a **Changes** button of its own in its toolbar.

The button opens a panel beside the session. Drag the panel's left edge to make
it wider or narrower, use **Maximize changes** to give it the whole view and
**Restore changes size** to put it back, and close it with **Close changes** or
by pressing `Escape`.

<!-- screenshot: changes panel -->

### This session and All uncommitted

**This session** lists what changed since the session started. Edits you made
before that are not listed, because the session's starting point is the
workspace as Lumora found it when the agent began. **All uncommitted** ignores
the session and lists everything that differs from the last commit. It needs a
git repository; in a plain folder it says so instead.

Select a file to read its changes beside the list. A binary file, and a change
too large to render, are reported rather than shown.

### What you can do with a file

Every row has a **File actions** menu with **Open**, **Show in folder**, and
**Copy path**. Lumora never runs what it opens: a program, a script, an
installer, or a shortcut is shown in its folder instead of being opened. A path
that leads outside the workspace is refused, including a link inside the
workspace that points out of it, and the panel reports that it did not work.

### Mark reviewed

**Mark reviewed** on one file, or **Mark all reviewed** for every file in the
list, moves the session's starting point forward. Those files leave the list,
the count in the header drops, and the batch is filed under **History** so you
can open it again later. Nothing on disk changes: Lumora does not commit,
stage, or edit anything, and the workspace is left as the agent left it.

A file that goes back to its original content leaves the list too, whether the
agent undid its own edit or you did. When the agent commits during the session,
its files move to the **Committed** group at the end of the list, which stays
closed until you open it.

### History

**History** in the panel lists this workspace's sessions, newest first, with
when each one started and the batches reviewed in it. Select a batch to see
exactly the files it covered, then use **Back to history** or `Escape` to return.
**Show earlier sessions** loads more. The same history is one button away on the
workspace page, and **View changes** in a session's right-click menu opens it
with that session in view.

### What the notices mean

- **Tracking started after the agent began, so its first edits may be missing.**
  Lumora gives the first snapshot up to three seconds and starts the agent
  anyway. Reading a large folder for the first time can take longer than that;
  later sessions in the same workspace are quick.
- **Another session is working in this workspace; its changes appear here too.**
  Lumora lists what changed in the folder, not who changed it.
- **Only the first 5,000 files are listed.** The list stops there.
- **Install git to see what changed in this workspace.** Lumora uses git to take
  its snapshots. Install it and Lumora picks it up within a minute, without a
  restart.
- **This workspace folder is not available.** The folder has been moved or
  renamed, or its drive is not connected.
- **This workspace is too large to track changes in.** A snapshot took longer
  than Lumora allows.

### Where the snapshots live

Lumora takes every snapshot into its own application-data folder, beside its
database. The workspace is only read: nothing is written into it, its `.git`
folder is never touched, and no commit, branch, or stash of yours is changed. A
workspace's snapshots are removed 14 days after its last session ended, together
with that session's review history.

### Limits

Changes are offered for sessions on this computer only; a remote computer's
sessions have no **Changes** button yet. Git must be installed, and a workspace
that is not a git repository has **This session** but not **All uncommitted**.
Lumora does not record who made each change, so a file that you and the agent
both edited is listed simply as changed.

## Terminal profiles

Terminal profiles describe the shell Lumora uses to resolve provider commands,
aliases, wrappers, and environment initialization. Open **Terminal profiles**
to inspect detected shells and choose the default. Provider-specific commands
remain under **Settings > Providers**, while additional layered launch values
belong under **Settings > Launch**.

## Default keyboard shortcuts

All application shortcuts can be changed under **Settings > Keyboard**.
Lumora intentionally does not use browser-style `Tab` or `Shift+Tab` navigation.

| Default shortcut | Action |
| --- | --- |
| `Ctrl+Tab` | Cycle active terminal tabs while the terminal page is visible |
| Up / Down | Change the highlighted session while the terminal switcher is open |
| `Alt+Shift+Left` / `Alt+Shift+Right` | Move the focused terminal tab |
| `Ctrl+Shift+T` | Return to running terminals and focus terminal input |
| `Ctrl+Shift+L` | Collapse or expand the sidebar |
| `Ctrl+1` | Open Home |
| `Ctrl+2` | Open Workspaces |
| `Ctrl+3` | Open All Sessions |
| `Ctrl+4` | Open Terminal Profiles |
| `Ctrl+5` | Open Remote Computers |
| `Ctrl+,` | Open Settings |

Hold the switcher shortcut's modifier to keep the switcher open and release it
to move to the highlighted session. The list scrolls when more terminals are
open than fit the window, and following the highlight keeps it in view.
Switching away from Lumora closes the switcher without changing the active
session.

## More guides

- [Settings and customization](SETTINGS.md)
- [Remote computers](REMOTE.md)
- [Move sessions between devices](SESSION_TRANSFER.md)
- [Provider support and verification](PROVIDER_SUPPORT.md)
- [Troubleshooting Lumora](TROUBLESHOOTING.md)
