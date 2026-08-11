# Changelog

All notable user-visible changes to Lumora are recorded in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and Lumora uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Add isolated remote-computer windows with SSH profile management, explicit
  host-fingerprint trust, remote platform detection, and ephemeral credentials.
- Add a bounded cross-platform Lumora helper protocol and verified helper
  bundle for Windows, macOS, and Linux on x64 and arm64.
- Add an explicit Lumora confirmation workflow that installs or safely replaces
  the per-user remote helper, verifies its digest, and negotiates compatibility
  before marking the remote target ready.
- Add isolated remote **Environment** and **Providers** settings that discover
  remote Node.js, npm, and target-enabled agent CLIs with paths, versions,
  manual refresh, and per-target provider preferences.
- Add a target-scoped remote Lumora shell with Home, Workspaces, All sessions,
  and Settings; a normalized metadata-only catalog; bounded pagination;
  explicit per-provider coverage; and metadata discovery for Codex, Claude
  Code, Gemini CLI, OpenCode, GitHub Copilot CLI, and Qwen Code.
- Add SSH PTY-backed remote terminals with new-session and exact same-provider
  resume for all six session-managed providers on Windows, macOS, and Linux
  targets.
- Add target-scoped provider start-command customization under remote
  **Settings > Launch**, isolated from local Lumora launch settings.
- Reuse the complete Provider Settings cards in remote Lumora, including
  target-specific start commands, public version checks, official guide links,
  and explicitly confirmed install/update actions for allowlisted npm providers.
- Add opt-in per-profile remembering for SSH passwords and private-key
  passphrases, protected by operating-system secure storage, plus opt-in
  automatic connection for password, private-key, and SSH-agent profiles.

### Changed

- Make isolated remote windows use Lumora's global theme, managed background,
  opacity hierarchy, mosaic, popup, scrollbar, and shared control styles.
- Reuse Lumora's main shell and catalog views after a remote target reaches
  ready, while keeping the pre-connection and helper setup flow isolated. The
  shared new/resume dialogs, terminal tabs, viewport, details, clipboard,
  shortcut capture, and stop behavior are reused in the remote shell.
- Restore remote Lumora windows from their own shared window size and make them
  honor the global **Start with a maximized window** preference just like the
  local window.

### Fixed

- Standardize dropdowns across local and remote catalogs, session workflows,
  settings, terminal profiles, and transfers on Lumora's overlay menu, and use
  a Lumora confirmation dialog when opening terminal links.
- Let remotely discovered npm and provider wrappers resolve companion runtimes
  from their installation directory when reading versions.
- Serialize automatic remote discovery and session scans over the helper
  channel, and report recoverable provider scan failures inside the catalog
  instead of raising a generic remote-target IPC error.
- Compare provider session timestamps chronologically during catalog
  synchronization so resumed sessions remain valid when providers change ISO
  timestamp precision.

- Ensure `npm run dev` builds a missing or stale verified remote-helper bundle
  before Electron starts, while reusing an already current bundle in subsequent
  development launches and isolated worktrees.
- Allow remote connection profiles to be edited and deleted with validated,
  in-app confirmation workflows and user-safe failure messages.
- Close a target's isolated window and dispose its active SSH/helper resources
  before changing or deleting that profile, preventing stale target state.
- Report remote connection failures as bounded, actionable stages for SSH,
  platform probing, helper verification, and file transfer without exposing
  credentials or raw remote diagnostics.
- Detect unexpected SSH transport closure, release target resources, and keep
  the current remote page and cached catalog visible with a reconnect banner.
- Reconcile newly started remote provider sessions back to their native catalog
  identity and safely handle repeated close, late PTY events, missing exit
  codes, disconnect, profile mutation, and application shutdown.

- Stop superseded launch-preflight requests from surfacing as terminal IPC
  failures while keeping their launch tokens unusable.
- Remove the unsupported Windows node-pty encoding option and its development
  console warning.

### Security

- Scope remote-helper inspection and installation to the immutable target of
  the authorized remote window; the renderer cannot supply or change that
  target identifier.
- Keep remote helper installation non-elevated, versioned, digest-verified, and
  atomically activated without exposing remote diagnostics or credentials.
- Keep remote discovery read-only and allowlisted with bounded probes. Remote
  environment variables, credentials, tokens, and provider session contents
  are not returned to the renderer.
- Keep remote provider lifecycle execution target-bound and non-elevated, with
  generated package allowlists, structured arguments, bounded time/output, and
  no raw npm or shell diagnostics exposed to the renderer.
- Keep remote session discovery metadata-only, strip helper-private source keys
  at the main-process boundary, and bound command output, page size, page count,
  record count, file enumeration, file reads, provider protocol traffic, and
  control-frame size.
- Resolve remote launch authority from the immutable sender-window target,
  validate absolute provider/workspace paths and shell arguments in the main
  process, and deliver PTY events only to that target's isolated window.
- Expose only a read-only appearance projection to isolated remote windows;
  appearance mutations remain restricted to the local Lumora window.
- Keep remembered remote credentials outside ordinary profile data as
  OS-protected encrypted blobs, reject insecure Linux fallback storage, remove
  credentials on authentication changes or profile deletion, and limit
  automatic connection to one host-verified attempt with manual recovery.

## [0.2.3] - 2026-08-03

### Changed

- Replace browser-native hover titles with compact, theme-aware Lumora tooltips
  that support delayed hover, deliberate keyboard focus, shortcut labels,
  overflow-only hints, and viewport-safe placement.
- Make navigation, catalog cards, and page toolbar actions follow app-style
  focus behavior while preserving normal input, dialog, settings, transfer,
  shortcut-recorder, and terminal focus.

## [0.2.2] - 2026-07-31

### Changed

- Change the default open/focus-terminal shortcut from `Ctrl+T` to
  `Ctrl+Shift+T`. Existing installations that still use the former default are
  migrated automatically; user-customized shortcuts are preserved.
- Give a focused provider terminal priority over non-reserved Lumora shortcuts
  so native TUI controls are not intercepted. `Ctrl+Tab` and `Ctrl+Shift+L`
  remain Lumora controls.
- Add an isolated bracketed-paste compatibility attempt for Codex
  `Shift+Enter`, while preserving existing modified-Enter compatibility
  sequences for other provider and modifier combinations.

### Fixed

- Stop managed sessions with a bounded graceful shutdown sequence before native
  PTY escalation, wait for the process's real exit event, and report an
  unobservable forced exit honestly as `runtime_lost`.
- Coalesce concurrent Stop and application-quit requests so Lumora performs one
  native shutdown sequence per managed terminal.

### Performance

- Batch adjacent PTY output into bounded IPC events and retain the attachment
  snapshot in bounded chunks, reducing main-process work during output-heavy
  native session resume.
- Rebuild the native tray menu only for runtime state changes, not for every
  terminal output fragment.

### Known issues

- Codex `Shift+Enter` does not reliably insert a multiline newline inside
  Lumora's embedded terminal. The compatibility sequence is retained for
  continued investigation, but the issue is not considered fixed.

## [0.2.1] - 2026-07-30

### Added

- Add a native Lumora tray/menu-bar icon with platform-appropriate visible
  artwork, live running-agent count, recent session shortcuts, window show/hide
  control, and an explicit orderly exit.
- Add a General settings switch that chooses whether closing the window exits
  Lumora or hides it while keeping managed agents running.
- Add a dedicated Appearance settings category with live Lumora mixed, Light,
  and Dark themes. New and migrated installations use Lumora's original mixed
  theme by default, while managed terminals remain dark unless their separate
  light-terminal option is enabled.
- Add an optional full-window custom background with managed local image
  storage and controls for opacity, brightness, blur, fit, position, surface
  transparency, terminal transparency, and an optional `0–24 px` Surface
  mosaic. Surface and terminal transparency support the full `0–100%` range;
  terminal canvases, terminal page chrome, system status, controls, cards, and
  in-app dialogs follow those controls. Semantic opacity levels distinguish
  recessed, normal, raised, and popup surfaces, while popups retain a readable
  minimum opacity. Mosaic defaults to zero so custom backgrounds can remain
  clear.

### Changed

- Remove the static topbar provider-discovery badge, which did not report live
  scan state or provide an action. Dynamic discovery health remains available
  on the Home page and in provider settings.
- Reopening Lumora while another instance is hidden now restores and focuses
  the existing window instead of starting a second application process.

### Fixed

- Open confirmed HTTP(S) hyperlinks from managed terminals in the user's
  default browser while keeping renderer-created windows and unsafe URL
  protocols blocked.
- Preserve POSIX nested workspace paths when importing Claude Code sessions on
  macOS and Linux, and keep transfer dialog path verification platform-native.
- Make xterm's parent viewport follow Terminal opacity so managed backgrounds
  remain visible through the complete PTY area while provider ANSI colors stay
  intact.

### Security

- Validate, resize, and normalize custom backgrounds into an app-owned PNG.
  The renderer receives only a fixed `app://appearance/background` URL, never
  the selected source path or unrestricted filesystem access.

## [0.2.0] - 2026-07-30

### Added

- Add guarded cross-device session archives with encrypted-by-default export,
  mixed-provider import, cross-platform workspace mapping, duplicate protection,
  progress, cancellation, and non-sensitive transfer history.
- Add a dedicated export-selection workflow under **Settings > Transfer**.
  Running, stale, unavailable, and unverified provider sessions remain disabled,
  while daily session and workspace pages stay focused on normal navigation.
- Add provider-native transfer adapters for OpenCode, Codex, Claude Code,
  Gemini CLI, GitHub Copilot CLI, and Qwen Code. Transfer routes are marked
  experimental in development builds so they can be tested, while normal
  packages remain disabled until their exact provider version and
  operating-system pair pass packaged verification.

### Security

- Keep provider files, archive paths, staging paths, and passwords in the main
  process behind validated, expiring operation tokens.
- Validate archive structure, paths, hashes, sizes, provider payload identity,
  destination workspace directories, and post-import native discovery before a
  transfer is accepted.

### Fixed

- Discover OpenCode sessions globally through OpenCode's official metadata-only
  database command, with a structured session-list fallback for older versions.
- Discover GitHub Copilot CLI session directories that contain legacy native
  workspace metadata but do not yet contain an events file.
- Roll back a newly forked Codex thread if native post-import setup fails or is
  cancelled, so a partial import is not left behind.
- Export Claude Code sessions whose Windows workspace casing was normalized by
  the catalog or whose transcript contains nested working directories, and map
  those nested paths when importing into a different workspace.

## [0.1.3] - 2026-07-29

### Changed

- Cap local Vitest runs at six workers to keep the desktop responsive while
  preserving the complete test suite. CI continues to use runner-appropriate
  Vitest parallelism.

## [0.1.2] - 2026-07-29

### Fixed

- Paste clipboard text into a live terminal with right-click.
- Close Codex terminals predictably after confirmed double-`Ctrl+C`, or when
  an explicit `/exit` or `/quit` command leaves the terminal process attached.

## [0.1.1] - 2026-07-28

### Added

- Allow open terminal tabs to be reordered by dragging or with
  `Alt+Shift+Left` and `Alt+Shift+Right` while a tab is focused. Visual tab
  order remains independent from the `Ctrl+Tab` most-recently-used switcher.

## [0.1.0] - 2026-07-28

### Added

- Initial Lumora MVP release for Windows, macOS, and Linux.
