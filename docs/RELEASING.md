# Releasing Lumora

Lumora's MVP release process builds unsigned native packages for Windows,
macOS, and Linux, verifies their runtime layout, and creates a draft GitHub
prerelease for manual review.

This guide is for maintainers. Installation and use belong in the
[user guide](../README.md).

## Release policy for the MVP

- Product name: **Lumora**
- Author: **HAYASAKA7**
- Packages are unsigned and unnotarized.
- Native packages are built on their matching operating system.
- Every package must pass automated layout verification and manual smoke tests.
- GitHub releases remain drafts until all platform results are accepted.
- Published MVP releases remain marked as prereleases.

Signing, notarization, and automatic updates are deferred until after MVP
testing.

## Verify source before packaging

Start from a clean checkout with the Node version selected by `.nvmrc`:

```powershell
npm ci
npm run verify
git status --short
```

The status command should not show source or lockfile changes.

## Build locally

For a quick unpacked build on the current operating system:

```powershell
npm run package:dir
```

For the configured native installer or application image:

```powershell
npm run package
```

Output is written to `dist/`. Packaging is native-only: build Windows on
Windows, macOS on macOS, and Linux on Linux.

The explicit commands used by CI are:

```powershell
# Windows x64
npx electron-builder --win nsis --x64 --publish never
node scripts/release/verify-package.cjs --platform win --arch x64
```

```bash
# Linux x64
npx electron-builder --linux AppImage --x64 --publish never
node scripts/release/verify-package.cjs --platform linux --arch x64
```

```bash
# macOS Apple Silicon
npx electron-builder --mac dmg --arm64 --publish never
node scripts/release/verify-package.cjs --platform mac --arch arm64

# macOS Intel
npx electron-builder --mac dmg --x64 --publish never
node scripts/release/verify-package.cjs --platform mac --arch x64
```

Always include `--publish never` in CI packaging commands. It prevents
electron-builder from treating CI detection as an implicit publish request.

## Manual package workflow

The **Unsigned MVP packages** workflow is manually dispatched from the GitHub
Actions page. It runs four independent jobs:

| Job | Runner | Output |
| --- | --- | --- |
| Windows x64 | `windows-latest` | NSIS `.exe` |
| Linux x64 | Ubuntu 24.04 | AppImage |
| macOS Apple Silicon | macOS 15 arm64 | DMG |
| macOS Intel | macOS 15 Intel | DMG |

Each job:

1. checks out the requested commit;
2. installs locked dependencies with `npm ci`;
3. runs `npm run verify`;
4. builds with publishing disabled;
5. runs `scripts/release/verify-package.cjs`;
6. uploads the native package as a workflow artifact for 14 days.

Download all four artifacts from the completed workflow run. A failed job or a
missing artifact blocks the release.

## Manual smoke-test checklist

Test each platform package, not only an unpacked development build.

1. Install or open Lumora and confirm its application, window, and taskbar or
   dock icons use the intended transparent artwork.
2. Confirm provider discovery distinguishes installed, incompatible, and
   missing CLIs.
3. Start a session using a normal provider command.
4. Start a session using a custom alias or wrapper command through an
   appropriate terminal profile.
5. Check terminal input, output, resizing, copying, keyboard and right-click
   pasting, confirmed double-`Ctrl+C` stop, and Codex `/exit` fallback.
6. Navigate between pages and return to the mounted terminal without duplicate
   output or an external page scrollbar.
7. Resume a provider with complete session support and confirm the exact native
   session opens with configured launch settings.
8. For Codex, Claude Code, and Gemini, verify a healthy local structured route,
   multiple turns, commands, cancellation, clean exit, and a deliberately
   disabled or unavailable route falling back to PTY. Confirm Remote Lumora
   remains PTY-routed.
8. Fork a Codex, Claude Code, or OpenCode session with a task and confirm a
   distinct native session opens while the source remains resumable.
9. Enable cross-agent handoff, transfer one saved session to a different
   full-session provider, and confirm the destination starts as a new session,
   uses the user's conversation language, and leaves the source unchanged.
10. Exit the provider and confirm its tab closes and saved-session views refresh.
11. Restart Lumora and confirm workspaces, settings, trust decisions, window
   state, and history persist.
12. Confirm an unpackaged development build still uses separate application
    data from the installed package.

Record the package filename and result for every target.

## Enable a verified transfer route

Do this only after the exact packaged OpenCode source-to-destination route has
passed every step in the transfer matrix in
[Provider support and verification](PROVIDER_SUPPORT.md). A development build,
a unit test, or a successful route on another provider version or operating
system is not evidence for this route.

From the verified Lumora commit, record one passing route:

```powershell
node scripts/release/record-transfer-verification.cjs --provider opencode --source win32 --destination linux --version (opencode --version) --commit (git rev-parse HEAD)
```

Use `win32`, `darwin`, or `linux` for both platform arguments. Repeat the command
only for other combinations that independently passed. The recorder validates
all values, generates a timestamped evidence hash, refuses duplicate routes,
and rewrites the table in deterministic order.

Never edit the verified route table by hand. Review the generated diff, run
`npm run verify`, build the affected native packages again, and commit the route
evidence separately. A failing or untested combination must remain absent and
will continue to show **Not verified** in Lumora.

## Prepare a version

Update both `package.json` and `package-lock.json` to the same semantic version.
Then run:

```powershell
npm ci
npm run verify
```

Confirm the two package files report the same version, then commit the version
change before creating the tag. The tag-triggered workflow runs
`verify-release-tag.cjs` with GitHub's tag name and rejects any mismatch.

## Create the draft prerelease

Push a tag that exactly matches the package version. For version `0.5.0`:

```powershell
git tag v0.5.0
git push origin v0.5.0
```

The **Lumora unsigned prerelease** workflow then:

1. validates the tag and source;
2. runs the complete source verification;
3. builds and verifies all four native packages;
4. downloads the packages into one release job;
5. generates `SHA256SUMS.txt`;
6. creates a draft GitHub prerelease with generated notes.

The workflow uses GitHub's built-in token only in the final release job. The
electron-builder steps keep publishing disabled and do not require a personal
access token.

## Review the draft

Before publishing, verify:

- the title and tag match the intended version;
- all four package names and architectures are correct;
- `SHA256SUMS.txt` contains every package;
- generated release notes do not expose private development material;
- every manual smoke test passed;
- the release remains marked as a prerelease;
- the unsigned-install warning is prominent.

Publish the draft manually only after all checks pass. Do not reuse artifacts
from a failed or superseded workflow run.

## CI workflow roles

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| **CI** | Push and pull request | Test, typecheck, and build on all three OS families |
| **Unsigned MVP packages** | Manual dispatch | Produce temporary packages for cross-platform testing |
| **Lumora unsigned prerelease** | Matching `v*` tag | Create verified release assets and a draft prerelease |
