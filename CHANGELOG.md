# Changelog

All notable user-visible changes to Lumora are recorded in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and Lumora uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.1] - 2026-07-30

### Changed

- Remove the static topbar provider-discovery badge, which did not report live
  scan state or provide an action. Dynamic discovery health remains available
  on the Home page and in provider settings.

### Fixed

- Open confirmed HTTP(S) hyperlinks from managed terminals in the user's
  default browser while keeping renderer-created windows and unsafe URL
  protocols blocked.
- Preserve POSIX nested workspace paths when importing Claude Code sessions on
  macOS and Linux, and keep transfer dialog path verification platform-native.

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
