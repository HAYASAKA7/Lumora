# Changelog

All notable user-visible changes to Lumora are recorded in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and Lumora uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Stop the terminal slicing its last line. The terminal fitted one row more
  than its container shows, so the bottom line of an agent's status bar was cut
  off by the edge. The extra row is dropped when it does not fit.

### Added

- Choose the terminal text size under **Settings → Appearance**, beside the
  terminal font. Agent interfaces that drew too small can be made readable, and
  the change reaches terminals that are already open, local and remote, without
  reopening them. Larger text leaves fewer columns, so a wide interface wraps
  sooner.

- Cancel a provider update while it runs. **Cancel update** stops the npm
  process Lumora started, including the processes it spawned underneath, rather
  than only clearing the progress indicator. Lumora re-reads the provider
  afterwards, because stopping an install partway can leave a different version
  on disk than the one shown. Cancelling is reported as an outcome rather than
  a failure, so it no longer prints an error in the application log.

### Fixed

- Explain why a provider update failed instead of reporting a generic error.
  npm replaces a global package by moving the installed one aside first, and on
  Windows a running provider's files cannot be moved, so updating a provider
  while it was in use both failed and left the installation half-replaced.
  Lumora now recognises that failure and asks you to close the running sessions
  first. npm's own output is still never shown, because it can carry registry
  credentials.

## [0.5.3] - 2026-09-03

### Fixed

- Give the session loading screen Lumora's own buttons. **Try again** and
  **Trust and continue** were styled with a class the stylesheet never defined,
  so they appeared as plain grey system buttons instead of Lumora controls. The
  approval buttons in the unified agent view had the same problem.
- Count agents running in the Unified UI as running agents. The **Running
  agents** card on the home view and the **Active agents** figure in
  Diagnostics both counted only agents running in a native terminal, so an
  agent working in Lumora's own interface showed up nowhere in those totals.
  The status bar, the tray menu and the quit warning already counted both.
- List a Unified UI session in **Running sessions** while it is still starting.
  Resuming into the Unified UI left the session missing from the running list,
  the status bar and the home count until the provider finished connecting,
  unlike a terminal resume, which appears as soon as it starts.
- Scroll dialogs whose content is taller than the window. **Session details**
  and every other Lumora dialog cut their content off at the bottom edge with
  no scrollbar, hiding the rest of the page and, in dialogs that have one, the
  row of action buttons. Short dialogs are unchanged.
- Keep the Ctrl+Tab terminal switcher on screen. With about a dozen or more
  terminals open it grew past the bottom of the window, taking the last entries
  and the hint line with it. It now stops at the window edge and scrolls its
  list, following the selection as you cycle. It looks the same whenever it
  already fits.
- Close the Ctrl+Tab terminal switcher when you switch away from Lumora.
  Windows takes Alt+Tab before Lumora sees the key release that normally closes
  the switcher, so the popup could stay on screen after you came back. The
  pending switch is abandoned rather than applied.
- Stop drawing a focus ring around the terminal switcher list. The list takes
  focus only to receive keys, so the ring marked the whole popup as focused
  while saying nothing the highlighted row did not already say.

## [0.5.2] - 2026-09-03

### Fixed

- Show the current name for Claude Code sessions that were renamed inside the
  provider. Claude Code records a rename both as a transcript entry and as an
  authoritative sidecar file, and it writes its automatic title immediately
  after the rename, so Lumora kept displaying the automatic title instead of the
  name you chose.
- Keep Claude Code sessions visible after the agent moves between folders. A
  session that started in one workspace and then worked inside a git worktree
  or subfolder was discarded during discovery, so its name, activity time and
  token usage silently stopped updating. Such a session now stays listed under
  the workspace it started in, which is also the workspace Claude Code resumes
  it from.

## [0.5.1] - 2026-09-03

### Fixed

- Restore cross-agent handoff for large file-backed sessions by copying the
  provider-owned transcript first and normalizing it incrementally instead of
  loading the complete source into memory.
- Preserve useful context from oversized histories by retaining bounded opening
  and recent messages, recent tool activity, and explicit partial-coverage
  warnings while leaving the original provider session unchanged.

### Performance

- Bound cross-agent handoff memory use, individual JSONL records, retained
  messages, tool activity, and Claude tool-result tracking so large or malformed
  histories cannot cause unbounded main-process work.

## [0.5.0] - 2026-09-01

### Added

- Add a local Unified UI for verified Codex app-server, Claude Agent SDK, and
  Gemini ACP integrations. The conversation view supports streamed Markdown,
  provider commands and models, cancellation, approvals, process and tool
  activity, file diffs, session usage details, and provider account limits when
  the integration exposes them.
- Extend the local Unified UI capability pipeline to OpenCode, Cursor CLI,
  GitHub Copilot CLI, Qwen Code, Kimi Code, and goose through their native ACP
  server modes. Each route uses its provider-owned executable, authentication,
  session identity, command list, model configuration, tool activity,
  permissions, cancellation, and history capabilities when advertised.
- Add bounded, progressively loaded conversation history. Lumora initially
  renders a small recent window and loads earlier turns as the user scrolls,
  reducing resume-time renderer work for long sessions.
- Resume sessions directly from their normal primary action. Lumora activates
  an already-running session, uses a verified local Unified UI when available,
  and otherwise starts the native PTY path. For providers with an enabled and
  verified Unified UI, right-click can explicitly open that UI or use the
  native terminal for only that launch without changing the saved provider
  preference. The advanced resume dialog remains available, while Remote
  Lumora continues to use direct PTY resume.
- Add an explicitly confirmed **Automatically trust workspaces** security
  preference for users who choose to bypass per-workspace launch confirmation.
- Add an Appearance preference for the Unified UI user-message color while
  preserving the active theme color as the default.

### Changed

- Navigate the open-terminal switcher with Up and Down while holding its
  configured modifier, including continuous key-repeat and wrapped selection.
- Improve direct session launch responsiveness by beginning the normal resume
  flow immediately and keeping preparation and loading inside the terminal
  workspace. Navigation and other Lumora pages remain usable while a provider
  connects, and bounded history loading avoids rendering an entire long session
  before its recent conversation becomes useful.
- Route Unified UI availability through provider capability probes and
  per-provider settings. Disabled, unavailable, incompatible, timed-out, or
  failed integrations fall back to the existing native terminal automatically.
- Gate every ACP route on a bounded protocol handshake and preserve automatic
  native PTY fallback when the installed provider version is unavailable,
  incompatible, times out, or cannot start a structured session. Cursor CLI
  and goose expose new Unified UI sessions while remaining launch-only catalog
  providers.
- Replace expanded inline Unified UI controls with one target-scoped master
  switch and a Lumora detailed-settings dialog. Turning the master switch off
  forces native PTY routing without erasing individual provider choices.
  Provider start commands remain configured in the installation cards rather
  than being duplicated in the Unified UI dialog.
- Keep provider settings controls, conversation actions, dialogs, context
  menus, message-color actions, and loading states aligned with Lumora's shared
  UI components and spacing rules.

### Fixed

- Accept filesystem requests inside ACP workspaces reached through canonical
  path aliases, fixing the Windows and macOS verification failure without
  weakening the real-path containment check against symlink escapes.
- Stabilize structured provider lifecycle handling across first responses,
  subsequent turns, commands, cancellation, reconnection, and clean exit.
- Keep the composer focused after sending, follow new output only while the
  user has not scrolled away, preserve earlier history after a turn completes,
  and keep long conversations visible without unbounded initial rendering.
- Prevent a Unified UI session and a PTY session from concurrently owning the
  same provider session; selecting a running session returns to its existing
  runtime instead of creating a duplicate.
- Cancel a direct session launch when its loading surface is closed, including
  structured-provider startup and late PTY fallback races, so a hidden launch
  cannot leave an agent process running in the background.
- Accept an explicitly selected native PTY result across the validated IPC
  boundary, preventing an already-running terminal from being reported as a
  failed direct launch before its terminal page appears.
- Keep Unified UI detailed settings usable while capability checks run: saved
  provider choices render independently, stale checks cannot overwrite newer
  results, and Close or Escape never becomes trapped behind a slow probe.

### Security

- Keep structured provider processes and session data in the Electron main
  process behind schema-validated IPC, bounded transports, expiring launch
  tokens, provider capability checks, workspace trust, and one-writer session
  ownership. The sandboxed renderer receives normalized events rather than
  direct filesystem or process access.
- Keep additional ACP providers behind the same main-process boundary, strict
  schemas, workspace-confined file access, bounded protocol frames, provider
  permission prompts, and one-writer session ownership.

## [0.4.2] - 2026-08-26

### Added

- Add separate collapsible **Running sessions** and **Recent sessions** lists
  to the expanded sidebar in local and Remote Lumora. Running sessions open
  their existing terminal, while recent sessions use the normal resume flow.

### Changed

- Keep running sessions prioritized within up to 70% of the sidebar and reserve
  at least 30% for recent sessions. Both lists scroll independently with
  low-distraction scrollbars, refresh when a runtime exits, and preserve their
  expanded state separately for local Lumora and each remote computer.
- Hide the terminal tab strip while the sidebar is expanded and restore it when
  the sidebar is collapsed, without unmounting or re-rendering terminal views.

## [0.4.1] - 2026-08-26

### Added

- Add independent interface and terminal font choices in **Settings >
  Appearance**. Lumora uses installed local fonts, preserves safe
  cross-platform fallbacks, and updates open local and remote terminal views
  without restarting or reattaching their sessions.
- Add data-only font presets under the Mods `fonts` directory, with bounded
  validation, isolated rejection, reload controls, and a native folder action.
- Add secure data-only Theme Mods under the Mods `themes` directory, with a
  fixed semantic palette, preview and apply controls, local and Remote Lumora
  appearance parity, bounded validation, and safe built-in-theme fallback.

### Changed

- Upgrade global settings storage to preserve the new font preferences while
  migrating older appearance settings without changing their existing theme
  or background choices.
- Require new user-visible features to update and validate all five bundled
  language packs in the same change.

### Fixed

- Stabilize Windows release verification for Remote Lumora automatic
  connection startup by synchronizing the renderer test with its asynchronous
  connection effect.

### Security

- Keep font Mods declarative: presets contain font-family names only. Lumora
  rejects symbolic links, mismatched filenames, oversized files, malformed
  schemas, and executable content; importing font files remains deferred. Mods
  data and native folder operations remain restricted to the local window.
- Reject theme links, oversized or malformed files, unsafe identifiers,
  filename mismatches, incomplete palettes, and insufficient text contrast.
  Theme Mods cannot load code or target arbitrary component selectors.

## [0.4.0] - 2026-08-25

### Added

- Add global multilingual UI support with system-language detection and
  explicit English, Simplified Chinese, Traditional Chinese, Japanese, and
  Korean selections across local Lumora, Remote Lumora, native menus,
  notifications, dialogs, and locale-aware dates, times, numbers, and plurals.
- Add secure data-only Mods support with a configurable local directory and a
  dedicated settings category for opening, reloading, and maintaining custom
  language packs.
- Add user language packs with partial overrides, immutable English fallback,
  atomic reload, compatibility warnings, and bounded JSON validation. Existing
  per-user language packs remain supported after upgrading.

### Changed

- Follow a supported operating-system language automatically on first use and
  fall back to English otherwise. The language selector now lists explicit
  languages using their native names.
- Package all built-in locale catalogs on Windows, macOS, and Linux, and add
  verification gates for catalog completeness, ICU placeholders, renderer
  strings, and packaged locale resources.

### Security

- Keep Mods data-only: Lumora does not load executable code from the Mods
  directory, rejects symbolic links and unsafe paths, and enforces limits for
  files, packs, messages, and nesting before activating a catalog.

## [0.3.8] - 2026-08-24

### Added

- Show verified agent updates in the Provider discovery card on local and
  Remote Lumora Home pages. Selecting the notice opens **Settings > Providers**
  for the existing update workflow, while disabled automatic checks remain
  silent and perform no background release request.

### Fixed

- Scope `Ctrl+Tab` terminal switching to the visible terminal page in local and
  Remote Lumora, so the terminal switcher no longer opens over Home,
  Workspaces, All sessions, Terminal profiles, or Settings.

## [0.3.7] - 2026-08-21

### Fixed

- Prevent browser-style `Tab` and `Shift+Tab` focus traversal across local and
  Remote Lumora windows, while preserving editable-control focus, terminal-native
  Tab input, modified Tab shortcuts, and shortcut recording.
- Keep long session names from stretching or wrapping terminal tabs. Tab titles
  now use a stable maximum width, display an ellipsis when clipped, and reveal
  the complete name through Lumora's overflow tooltip.

## [0.3.6] - 2026-08-21

### Added

- Add an About category to local and Remote Lumora settings with the installed
  Lumora version, developer, local platform, and connected remote-helper
  details.
- Passively check the latest stable Lumora GitHub release and show a safe
  **View update** link only when a newer version exists. Automatic update
  installation remains deferred until Lumora releases are signed.

## [0.3.5] - 2026-08-19

### Added

- Warn before a full Lumora exit stops active local or remote agents, with an
  independent General setting and an in-dialog **Don't show this warning
  again** choice.
- Warn before disconnecting and closing a Remote Lumora window that has active
  terminal sessions, with its own General setting and suppression choice.

### Fixed

- Limit warning-suppression interaction to the checkbox itself instead of
  making the entire text row clickable, while preserving its accessible label.

## [0.3.4] - 2026-08-16

### Fixed

- Correct Diagnostics resource reporting by separating active local agents from
  Lumora's Electron processes, identifying memory as a cumulative working set,
  and refreshing the first CPU sample when the page opens.
- Keep missing or incompatible remote-helper installation available after an
  automatic SSH connection, without requiring a manual disconnect and
  reconnect.

## [0.3.3] - 2026-08-13

### Added

- Mark provider-owned sessions that are already active in Lumora as Running
  across Home, workspace details, All Sessions, and the tray/menu-bar menu.
  Selecting one now restores and focuses its existing local or remote terminal
  instead of opening another resume workflow.
- Add privacy-safe local diagnostics with bounded process metrics, structured
  lifecycle events, abnormal-shutdown detection, manual refresh, and explicit
  local JSON export from **Settings > Diagnostics**. Diagnostic storage and
  exports exclude prompts, terminal output, session content, credentials,
  environment values, raw exception text, stack traces, identities, and paths.
- Allow users to choose the bounded automatic diagnostic journal folder and
  remember the last successful diagnostic export directory. Custom journal
  changes apply on restart and safely fall back to Lumora's default folder when
  unavailable.
- Add Lumora-styled page and per-terminal recovery boundaries so a renderer
  component failure keeps navigation, unrelated terminals, and managed PTYs
  available for retry.

### Changed

- End startup presentation as soon as persisted application state is ready,
  while provider, environment, and catalog discovery continue in the
  background with the last valid cards and counts kept visible.

### Fixed

- Prevent duplicate provider processes from resuming the same native session,
  including rapid-click and stale-renderer races, while allowing normal resume
  again after the original managed runtime exits.
- Drain terminal launches that are still spawning when shutdown begins,
  coalesce repeated shutdown requests, and reject new launches once teardown
  owns the runtime.
- Wait for in-flight SSH connection attempts before closing remote resources,
  and make concurrent remote shutdown callers share the same completion.

### Performance

- Bound provider and session discovery concurrency, coalesce duplicate
  environment/provider/catalog scans, retain at most one required fresh
  follow-up, and reject stale renderer completions.
- Record bounded scan durations, cache hits, queue counts, and catalog result
  counts in local privacy-safe diagnostics.
- Add a deterministic startup scan-coordination benchmark alongside the
  catalog, terminal-output, and transfer benchmarks.

## [0.3.2] - 2026-08-13

### Added

- Add Kimi Code as a complete local and remote session provider on Windows,
  macOS, and Linux: detection, provider enablement, custom launch commands,
  new sessions, metadata-only catalog discovery, exact `--session` resume,
  rename refresh, effective lifetime-token totals, and source-only cross-agent
  handoff.
- Add explicitly confirmed npm installation for Kimi Code when Node.js 22.19
  or newer is available. Existing Kimi installations use the official updater
  or installation guide instead of an unverified npm overwrite.
- Add Start Menu and desktop shortcut choices to the assisted Windows
  installer. Start Menu is selected by default, desktop is cleared by default,
  silent installations use those defaults, and upgrades preserve the existing
  shortcut state.
- Add Experimental cross-device export and import for Kimi Code sessions.
  Lumora copies the complete selected provider-owned session directory,
  preserves its native identity, maps it to the chosen destination workspace,
  and updates Kimi's append-only session index without transferring account
  credentials or global provider configuration.

### Fixed

- Keep npm-based provider installation, version checks, and terminal launch on
  one compatible Node.js runtime when multiple Node installations are present.
  This prevents a newly installed provider such as Kimi Code from launching
  under an older incompatible Node.js executable.

### Security

- Bound and validate Kimi's session index, state, agent wire data, paths,
  symlinks, record counts, line sizes, token arithmetic, and handoff snapshots.
  Prompts and raw session content remain outside Lumora's searchable catalog.
- Validate every Kimi transfer file path, type, size, digest, native identity,
  workspace bucket, and required session artifact before writing provider data.
  Duplicate imports are skipped, and failed imports remove only the newly
  staged native session and append a Kimi deletion record.

## [0.3.1] - 2026-08-12

### Added

- Paste clipboard images into any live local or remote managed terminal. Lumora
  stages a private, bounded PNG on the terminal's own machine and inserts only
  a readable file reference without submitting the prompt automatically.
- Add target-scoped workspace visibility controls for local and remote
  catalogs. A workspace can be hidden by itself or together with its sessions,
  and the searchable Hidden workspaces dialog can restore one, several, or all
  selections without deleting provider data.

### Changed

- Add General settings to hide unavailable workspaces and currently unusable
  sessions. Catalog filtering is performed in memory after one complete scan,
  preserving responsive search and provider filters for larger catalogs.
- Open remembered automatic SSH profiles through a dedicated connecting state
  instead of briefly exposing authentication controls. If the attempt fails,
  Remote Lumora restores the existing login page with its connection error.
- Make every preference displayed under **General** global across the local
  window and all remote Lumora windows. Changes propagate to open windows
  immediately, while enabled providers, launch commands, credentials, and
  other machine-specific configuration remain isolated per execution target.
- Move **Remote computers** into the local window's primary navigation and
  place **Settings** below the separator in both local and remote Lumora.
- Change the default navigation shortcuts so `Ctrl+5` opens **Remote
  computers** and `Ctrl+,` opens **Settings**. Both remain customizable, and
  existing shortcut settings migrate without losing user-defined bindings.
- Replace the obsolete local-footer `Local only` label with a live active-agent
  count using correct singular and plural labels.

### Performance

- Reduce local verification load with adaptive one-to-three-worker Vitest
  concurrency and avoid a redundant second TypeScript pass while retaining
  every test, helper, typecheck, and production-build gate.

## [0.3.0] - 2026-08-11

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
- Add a global remote-window close preference. Disconnect-on-close asks for
  confirmation when the target still has active terminals, with explicit
  **Keep running** and **Disconnect and close** choices.

### Changed

- Group General settings by function so related preferences share one section,
  including the cross-agent handoff switch and temporary-copy retention.
- Make isolated remote windows use Lumora's global theme, managed background,
  opacity hierarchy, mosaic, popup, scrollbar, and shared control styles.
- Reuse Lumora's main shell and catalog views after a remote target reaches
  ready, while keeping the pre-connection and helper setup flow isolated. The
  shared new/resume dialogs, terminal tabs, viewport, details, clipboard,
  shortcut capture, and stop behavior are reused in the remote shell.
- Restore remote Lumora windows from their own shared window size and make them
  honor the global **Start with a maximized window** preference just like the
  local window.
- Keep ready SSH/helper connections alive in the main Lumora process by
  default when an isolated remote window closes. Reopening restores cached
  discovery, catalog, and terminal state without an unnecessary rescan.
- Update remote-computer cards and the sidebar indicator from live connection
  lifecycle events so online state remains accurate across windows.

### Fixed

- Release the remote connection action after SSH/helper activation even when
  the `ready` lifecycle update rerenders an automatic connection, and keep slow
  credential-status refreshes from leaving Disconnect stuck on **Disconnecting**.
- Publish and persist the remote computer's offline state even when graceful
  terminal shutdown reports an error after its SSH resources have closed.
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
