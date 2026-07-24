<p align="center">
  <img src="resources/icons/lumora/source/lumora-symbol-gradient.svg" alt="Lumora" width="112" height="112">
</p>

<h1 align="center">Lumora</h1>

<p align="center"><strong>A local desktop workspace and session manager for native AI-agent CLIs.</strong></p>

Lumora gives installed AI-agent command-line tools one place for workspace
navigation, saved sessions, launch settings, and managed terminals. Providers
keep ownership of their session files, authentication, permissions, and usage
limits.

> Lumora 0.1 is an unsigned MVP. Read [Unsigned build notices](#unsigned-build-notices)
> before installing it.

<!-- DEMO: Add docs/media/lumora-demo.mp4 and a linked preview image here. -->

<!-- SCREENSHOT: Add docs/screenshots/home.png (Home and workspace overview). -->

## What you can do

- Detect supported agent CLIs and see their installed versions.
- Install or update allowlisted npm-based agents after confirmation.
- Add local workspaces and browse provider-owned sessions inside them.
- Search saved sessions by title, workspace, and provider.
- Start a new provider session or resume an exact native session.
- Fork Codex, Claude Code, or OpenCode sessions into a new native session while
  leaving the original unchanged.
- Opt in to start a new provider session from another provider's saved context.
- Keep active sessions mounted in managed terminal tabs while navigating Lumora.
- Use custom shells, provider commands, aliases, and layered launch settings.
- Review the effective launch command before a provider starts.
- Require explicit, revocable trust for each workspace path.

## Get Lumora

Download the package for your system from
[GitHub Releases](https://github.com/HAYASAKA7/Lumora/releases).

| System | Package |
| --- | --- |
| Windows x64 | `Lumora-*-win-x64.exe` |
| macOS Apple Silicon | `Lumora-*-mac-arm64.dmg` |
| macOS Intel | `Lumora-*-mac-x64.dmg` |
| Linux x64 | `Lumora-*-linux-x86_64.AppImage` |

### Unsigned build notices

The MVP packages are not code-signed or notarized.

- **Windows:** SmartScreen may warn about or block the installer. Confirm that
  the file came from this repository before allowing it.
- **macOS:** Gatekeeper may block the DMG or application. After verifying the
  source, use **System Settings > Privacy & Security > Open Anyway**.
- **Linux:** Make the AppImage executable before opening it:

  ```bash
  chmod +x Lumora-*.AppImage
  ```

Signing, notarization, and automatic updates are planned after MVP testing.

## Before your first session

Lumora manages provider CLIs; it does not replace them. Your computer needs:

- Node.js and npm. Lumora checks for them at startup and links to the official
  Node.js download when they are missing.
- At least one supported AI-agent CLI.
- Any account, authentication, or provider setup required by that CLI.

Provider commands must be available on `PATH`. You can confirm common commands
in a terminal:

```powershell
codex --version
claude --version
gemini --version
```

Every provider is optional. A missing or incompatible provider does not stop
healthy providers from working.

## First-run guide

1. Open **Settings > Environment** and confirm Node.js and npm are available.
2. Open **Settings > Providers** and review detected agents and versions.
3. Install a supported npm-based provider or follow its official installation
   guide, then select **Refresh**.
4. Open **Workspaces**, select **Add workspace**, and choose a project folder.
5. Select **New session**, then choose a workspace, provider, and terminal
   profile.
6. Review and confirm workspace trust when Lumora asks for it.
7. Start the session. Lumora opens the provider in a managed terminal.

Provider authentication and approval prompts appear inside the terminal and
continue to be controlled by the provider.

## Workspaces and saved sessions

The **Workspaces** page groups provider-owned sessions by project directory.
Select a workspace card to open its saved-session list. Select a session card
to open its continuation dialog. You can resume the original session, or—when
the provider supports native fork—start a separate native session from the same
context with a new task. Native forks keep the original provider session
unchanged.

The **All sessions** page searches across available workspaces. Provider filters
only include installed providers for which Lumora found resumable sessions.
The **Home** page keeps a smaller recent-session list with direct Resume actions.

Lumora reads supported provider metadata but does not rewrite provider session
files or copy transcript bodies into its catalog. When cross-agent handoff is
enabled, Lumora creates a separate temporary local copy only for the selected
handoff; the original session remains unchanged.

## Managed terminals

Active terminals stay mounted while you move between Lumora pages. Use the
terminal tab bar or `Ctrl+Tab` to switch between active sessions. When the
provider process exits, Lumora closes its tab and refreshes the catalog.

Terminal clipboard behavior:

- **Windows and Linux:** `Ctrl+V` pastes. `Ctrl+Shift+C` and `Ctrl+Shift+V`
  always copy and paste. `Ctrl+C` copies when text is selected.
- **macOS:** `Command+C` copies and `Command+V` pastes.
- With no selection, the first `Ctrl+C` arms an interrupt and the second press
  sends it to the provider. This reduces accidental process interruption.

<!-- SCREENSHOT: Add docs/screenshots/terminal.png (Managed terminal session). -->

## Settings

### General

Choose startup and navigation behavior, informational notices, and enabled
providers. Cross-agent session handoff is off by default. When enabled, its
retention setting controls when Lumora automatically deletes temporary managed
session copies.

### Providers

Review installation status and versions, install supported npm-based agents,
open official setup guides, and update compatible agents after confirmation.

### Environment

Check Node.js and npm independently from provider discovery.

### Launch

Set provider commands and launch values globally or for a provider, workspace,
or session. One-time values can be supplied before a launch. Lumora resolves
them in this order:

```text
Global < Provider < Workspace < Session < One-time launch
```

The launch preview shows the effective command, working directory, terminal,
and the layer that supplied each value. This supports aliases and wrapper
commands as long as the selected terminal profile can resolve them.

### Security

The first launch in an exact canonical workspace path requires confirmation.
Lumora stores the decision locally and applies it to new and resumed sessions.
You can revoke it from Settings; a path change requires a new decision.

Workspace trust is a consent gate, not an operating-system sandbox. The agent
still runs with your user account's permissions.

### Keyboard

All application shortcuts below can be changed in **Settings > Keyboard**.

| Default shortcut | Action |
| --- | --- |
| `Ctrl+Tab` | Cycle active terminal tabs in most-recently-used order |
| `Ctrl+T` | Return to currently running terminals and focus terminal input |
| `Ctrl+Shift+L` | Collapse or expand the sidebar |
| `Ctrl+1` | Open Home |
| `Ctrl+2` | Open Workspaces |
| `Ctrl+3` | Open All sessions |
| `Ctrl+4` | Open Terminal profiles |
| `Ctrl+5` | Open Settings |
| `Ctrl+,` | Open Settings |

## Supported providers

| Provider | Install/update | New session | Saved-session discovery and exact resume | Native fork |
| --- | --- | --- | --- | --- |
| Codex | Confirmed npm action | Yes | Yes | Yes |
| Claude Code | Confirmed npm action | Yes | Yes | Yes |
| Gemini CLI | Confirmed npm action | Yes | Yes | No |
| OpenCode | Confirmed npm action | Yes | Yes | Yes |
| GitHub Copilot CLI | Confirmed npm action | Yes | Yes | No |
| Qwen Code | Confirmed npm action | Yes | Yes | No |
| Antigravity | Official guide | Yes | No | No |
| Cursor CLI | Official guide | Yes | No | No |
| Amp | Official guide | Yes | No | No |
| Crush | Confirmed npm action | Yes | No | No |
| goose | Official guide | Yes | No | No |
| Aider | Official guide | Yes | No | No |

All providers can be launched on Windows, macOS, and Linux when their command
is installed and compatible. Launch-only providers remain available in
Settings and New session, but do not appear in saved-session pages or filters.

The six providers with complete session support can also be used as the source
or destination of an opt-in cross-agent handoff. A handoff starts a new native
session in the destination provider; it never converts or replaces the source
provider's session.

## Data and privacy

Lumora is local-first and has no Lumora cloud synchronization. It stores
normalized session metadata, settings, trust decisions, window state, and
managed runtime history in the operating system's application-data location.
Provider session files remain provider-owned read-only inputs.

A native same-provider fork delegates context handling to the provider and
does not create a Lumora transcript copy. An enabled cross-agent handoff stores
an immutable source copy, normalized
conversation files, and a small manifest under Lumora's local application-data
directory. These files are used only to bootstrap the destination provider and
are automatically removed according to the retention period in General
settings. They are not added to the searchable catalog.

Lumora does not add privacy guarantees beyond those of the provider CLI. The
provider may contact its own services according to its terms and configuration.

## Current limitations

- Generic PTY processes cannot be reattached after Lumora restarts. Lumora
  reports affected runtimes and lets you resume or restart them.
- Antigravity, Cursor CLI, Amp, Crush, goose, and Aider are launch-only.
- Cross-agent handoff is opt-in and depends on provider session formats. Lumora
  preserves user and assistant messages, while compact tool-activity coverage
  can vary by provider version. A handoff failure does not change the source
  session or prevent exact native resume.
- Provider-native authentication and approval flows must be completed inside
  the embedded terminal.
- WSL-specific orchestration, cloud sync, transcript full-text indexing,
  custom provider definitions, and multiline terminal input shortcuts are not
  part of the current MVP.
- Read-only session-content previews are deferred to a future phase. The
  intended design is an on-demand Session Details view that shows a small,
  normalized excerpt without resuming the provider session or importing its
  transcript into Lumora's catalog.
- Terminal viewport sizing remains a known issue on some layouts and will be
  handled in a future phase.

## Technical documentation

- [Provider support and verification](docs/PROVIDER_SUPPORT.md)
- [Troubleshooting guide](docs/TROUBLESHOOTING.md)
- [Architecture and privacy model](docs/ARCHITECTURE.md)
- [Development guide](docs/DEVELOPMENT.md)
- [Packaging and release guide](docs/RELEASING.md)

Lumora is authored by [HAYASAKA7](https://github.com/HAYASAKA7).
