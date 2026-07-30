# Changelog

All notable user-visible changes to Lumora are recorded in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and Lumora uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Add guarded cross-device session archives with encrypted-by-default export,
  mixed-provider import, cross-platform workspace mapping, duplicate protection,
  progress, cancellation, and non-sensitive transfer history.
- Add a dedicated export-selection workflow under **Settings > Transfer**.
  Running, stale, unavailable, and unverified provider sessions remain disabled,
  while daily session and workspace pages stay focused on normal navigation.
- Add the first provider-native transfer adapter for OpenCode. Transfer routes
  remain disabled until their exact provider version and operating-system pair
  pass packaged verification.

### Security

- Keep provider files, archive paths, staging paths, and passwords in the main
  process behind validated, expiring operation tokens.
- Validate archive structure, paths, hashes, sizes, provider payload identity,
  destination workspace directories, and post-import native discovery before a
  transfer is accepted.
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
