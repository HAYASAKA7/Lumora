# Lumora

Lumora is a local desktop workspace and session manager for native AI-agent
CLIs. It brings provider discovery, saved sessions, launch settings, lifecycle
guidance, and native CLI terminals into one Electron application without
replacing providers' own session formats or permission models.

<!-- SCREENSHOT: Add docs/screenshots/home.png (Home and workspace overview) -->

## Current MVP

Lumora is an active MVP. The current source supports the core local workflow:
discover installed providers, index their saved session metadata, start or
resume a native provider session, and operate it in an embedded terminal.

The project targets Windows, macOS, and Linux. CI verifies tests, TypeScript,
and production bundles on all three operating systems.

## Features

- Detect twelve supported agent CLIs and their installed versions.
- Install or update allowlisted npm-based providers after explicit
  confirmation, and open official instructions for other providers.
- Discover provider-owned session metadata without modifying provider files.
- Group and search sessions by workspace and provider.
- Start any detected supported provider in a managed terminal tab.
- Resume a selected native provider session using its provider identity.
- Close an exited session's terminal tab automatically.
- Detect common shells and support custom terminal profiles.
- Resolve global, provider, workspace, session, and one-time launch settings.
- Preview the effective command, working directory, terminal, and setting
  provenance before launch.
- Require persistent, explicit trust for the exact canonical workspace path
  before a provider can start, with revocation available in Settings.
- Record managed runtime history and report runtimes that cannot be reattached
  after an application restart.

<!-- SCREENSHOT: Add docs/screenshots/terminal.png (Managed terminal session) -->

## Supported platforms and providers

| Provider | Install/update | New launch | Session discovery | Exact resume | Platforms |
| --- | --- | --- | --- | --- | --- |
| Codex | Confirmed npm action | Yes | Yes | Yes | Windows, macOS, Linux |
| Claude Code | Confirmed npm action | Yes | Yes | Yes | Windows, macOS, Linux |
| Gemini CLI | Confirmed npm action | Yes | Yes | Yes | Windows, macOS, Linux |
| OpenCode | Confirmed npm action | Yes | Yes | Yes | Windows, macOS, Linux |
| GitHub Copilot CLI | Confirmed npm action | Yes | Yes | Yes | Windows, macOS, Linux |
| Qwen Code | Confirmed npm action | Yes | Yes | Yes | Windows, macOS, Linux |
| Antigravity | Official guide | Yes | No | No | Windows, macOS, Linux |
| Cursor CLI | Official guide | Yes | No | No | Windows, macOS, Linux |
| Amp | Official guide | Yes | No | No | Windows, macOS, Linux |
| Crush | Confirmed npm action | Yes | No | No | Windows, macOS, Linux |
| goose | Official guide | Yes | No | No | Windows, macOS, Linux |
| Aider | Official guide | Yes | No | No | Windows, macOS, Linux |

Home, Workspaces, All sessions, search, and provider filters use only
provider-owned sessions. A provider appears there only when its CLI is
installed, its adapter passes compatibility checks, Lumora supports both
discovery and exact resume for it, and at least one saved session exists.
Launch-only providers remain available in
Settings and New session.

Lumora uses the provider's official CLI behavior. Authentication, approvals,
sandboxing, and usage limits remain provider-owned.

## Prerequisites

- Node.js 22 or newer. The repository's `.nvmrc` selects Node.js 26.2.0.
- npm.
- At least one supported provider CLI, either installed manually or through an
  available confirmed install action in Provider Settings.
- Provider commands available on `PATH` so Lumora can discover and probe them.

Confirm the provider commands in a terminal before starting Lumora:

```powershell
codex --version
claude --version
gemini --version
```

Every provider is optional; Lumora reports each provider independently.

## Install and run

```powershell
npm install
npm run dev
```

`npm run dev` runs the Electron development application. Its pre-development
step installs Electron's platform-specific runtime when a fresh dependency
installation does not already contain it.

## Development commands

| Command | Purpose |
| --- | --- |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run typecheck` | Check the main/preload and renderer TypeScript projects |
| `npm run verify` | Run tests, type checks, and a production build |
| `npm run build` | Build Electron main, preload, and renderer bundles into `out/` |
| `npm run package:dir` | Build an unpacked native application for local testing |
| `npm run package` | Build the native installer or application image into `dist/` |

For a reproducible clean installation, CI uses `npm ci`.

## Package an unsigned MVP build

Create a local package from a clean dependency installation:

```powershell
npm ci
npm run package:dir
npm run package
```

`npm run package:dir` creates unpacked output for quick local inspection.
`npm run package` creates the native installer or application image under
`dist/`. Packaging is native-only: run these commands on the operating system
you are packaging, rather than expecting cross-compilation.

The GitHub Actions workflow **Unsigned MVP packages** builds each native target,
then verifies and uploads all four artifacts. Start it manually from the Actions
page with **Run workflow**. The workflow artifacts are retained for 14 days.
Open the completed workflow run and find its **Artifacts section**. Then
download the artifact for your platform.

| Target | Package |
| --- | --- |
| Windows x64 | NSIS `.exe` installer |
| Linux x64 | AppImage |
| macOS Intel x64 | DMG |
| macOS Apple Silicon arm64 | DMG |

These artifacts are unsigned MVP test builds. Use only artifacts produced by
this repository's **Unsigned MVP packages** workflow. Windows SmartScreen may
warn about or block the installer. macOS Gatekeeper may block the DMG or app;
after verifying its source, use **System Settings > Privacy & Security > Open
Anyway** to approve it. On Linux, make the downloaded AppImage executable
before launching it, for example with `chmod +x Lumora-*.AppImage`.

For each target, complete this manual smoke-test checklist:

1. Confirm the application launches and displays the Lumora app icon.
2. Confirm provider discovery reports installed and missing CLIs correctly.
3. Start a session using a custom CLI start command.
4. Check terminal input, output, and resize behavior without duplicate rendering
   or scrolling the page outside the fixed terminal UI.
5. Resume an installed session-supported provider and confirm it opens the
   exact native session while applying the configured start command.
6. Exit the provider process and confirm the session tab closes automatically.
7. Restart Lumora and confirm workspaces, settings, and history persist.

Signing, notarization, publishing, and automatic updates are deferred until
after MVP testing.

## Configuration

Lumora detects provider executables and terminal profiles automatically. The
Settings page can override provider launch commands globally or per provider,
workspace, and session. This supports aliases or wrapper commands such as a
custom Codex command defined in the user's shell environment. Terminal profiles
can also specify the shell executable and its startup arguments.

Launch settings are layered in this order:

```text
Global < Provider < Workspace < Session < One-time launch
```

The launch preview shows which layer supplied each effective value.

Workspace trust is separate from launch settings. The first launch in an exact
canonical workspace path requires explicit confirmation. Lumora persists that
decision locally for the workspace ID and path, applies it to both new and
resumed sessions, and lets it be revoked from Settings. A path change requires
a new decision. Trust allows the provider to run with the user's operating
system permissions; it is not an OS sandbox.

<!-- SCREENSHOT: Add docs/screenshots/launch-settings.png (Layered launch settings) -->

## Architecture and privacy

```text
Sandboxed React renderer + xterm.js
                  |
          schema-validated IPC
                  |
        Electron main process
        /          |           \
 provider registry |       platform services
  native agent CLIs|    Windows / macOS / Linux
                   |
            node-pty runtime host
                   |
              local SQLite
```

The renderer cannot read provider files, spawn processes, or access the
database directly. The main process validates IPC data and owns provider
discovery, session indexing, launch construction, and PTY processes.

Provider session sources are read-only inputs. Lumora stores normalized session
metadata and managed runtime history locally; it does not copy transcript
bodies into its catalog and does not provide cloud synchronization.

Workspace trust decisions are also stored in local SQLite as a workspace ID,
canonical path, and timestamp. They do not add an operating-system security
boundary: the selected provider still runs with the permissions of the user who
started Lumora. Trust is a persistent, revocable consent gate that prevents an
unapproved workspace launch; it is not a provider sandbox or filesystem
isolation mechanism.

## Current limitations

- Packaged artifacts are unsigned MVP test builds, so SmartScreen or Gatekeeper
  warnings are expected until signing and notarization are introduced.
- Generic PTY processes cannot be reattached after Lumora restarts; affected
  runtimes are reported honestly and can be resumed or restarted.
- Provider-native authentication and approval flows must be completed inside
  the embedded terminal.
- Antigravity, Cursor CLI, Amp, Crush, goose, and Aider are launch-only; they do
  not appear in saved-session pages or filters.
- WSL-specific orchestration, cloud sync, and transcript full-text indexing are
  outside the current MVP.

The detailed MVP architecture and acceptance criteria are documented in
[`docs/superpowers/specs/2026-07-10-agent-workspace-manager-mvp-design.md`](docs/superpowers/specs/2026-07-10-agent-workspace-manager-mvp-design.md).
