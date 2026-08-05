# Cross-platform standard

Every product change must account for Windows, macOS, and Linux. Remote-target
features add a second independent platform dimension: local UI platform and
remote execution platform must never be assumed to match.

## Platform rules

- Use `node:path` and Lumora path helpers; do not manually join separators.
- Detect executables through the platform locator and login-shell PATH logic.
- Keep commands as executable plus argument arrays. Shell syntax, profiles,
  quoting, and aliases are platform-specific.
- Terminal profiles must represent PowerShell, cmd, zsh, bash, fish, and custom
  shells without treating one as universal.
- Normalize workspace identity without changing the path used by the provider.
- Feature detection must rely on observed capabilities, not
  `process.platform` alone.

Windows and Linux must omit the default application menu; macOS keeps its native
system menu. Tray/status icons, taskbar/Dock icons, installer icons, and package
assets are separate surfaces and must use their platform-specific assets.

Native packages must be built on their host OS. Package verification must check
the correct `node-pty` helper layout for the target and must not assume a helper
name from another platform.

Remote probing must identify the remote OS and architecture through the SSH
connection before choosing helper or provider behavior. Local settings and
paths must not leak into the remote target.

Remote helper builds must cover Windows, macOS, and Linux independently from
the packaging host, with x64 and arm64 artifacts explicitly represented in the
verified manifest. Remote install paths and digest commands must use the
probed platform's conventions and must never reuse local path syntax.

## Canonical references

- `src/main/platform/`
- `src/main/runtime-paths.ts`
- `src/main/application-menu.ts`
- `src/main/branding/icon-assets.test.ts`
- `scripts/release/verify-package.cjs`
- `src/main/remote/platform-probe.ts`
- `scripts/helper/build-helper.cjs`

## Review checklist

- Which local and remote OS combinations does this affect?
- Are path, quoting, environment, menu, and icon assumptions portable?
- Are unsupported combinations reported honestly and safely?
- Do tests cover each platform branch without requiring that host OS?
