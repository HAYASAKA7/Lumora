# Remote computers

Remote computers are an experimental Lumora feature. The current phase creates
an isolated remote window, verifies SSH identity, detects the remote platform,
installs and negotiates a lightweight Lumora helper, and checks the remote
developer environment and enabled agent providers. After connection, the
window becomes a target-scoped Lumora shell with **Home**, **Workspaces**,
**All sessions**, and **Settings**. Remote resume, launch, and terminal
execution are not available yet.

## Connect a computer

1. Open the separate **Remote** entrance in the lower sidebar.
2. Add a direct SSH profile or an SSH-config host.
3. Observe the SHA-256 host fingerprint and compare it with the remote computer
   through a trusted channel.
4. Trust the fingerprint only when it matches.
5. Open the isolated remote window and connect with the configured password,
   private key, or SSH agent method.

Profiles can be edited or deleted from the local Remote page. Lumora closes the
profile's isolated window and active SSH/helper resources before either
mutation. Deletion requires an in-app confirmation and never removes files from
the remote computer.

Passwords and passphrases are connection-only values. Lumora does not save or
log them.

## Activate the helper

After SSH authentication, Lumora probes the remote operating system and
architecture. Supported helper targets are:

| Remote OS | Architectures |
| --- | --- |
| Windows | x64, arm64 |
| macOS | x64, arm64 |
| Linux | x64, arm64 |

If the helper is missing or invalid, the remote window displays the packaged
version and exact per-user install location. Installation begins only after an
explicit confirmation. Lumora uploads a temporary copy, verifies its size and
SHA-256 digest on the remote computer, applies executable permissions on Unix,
and atomically activates it. An invalid existing helper is not replaced until
the new upload has passed verification.

The helper runs only while Lumora has an active remote connection and consumes
minimal resources. It requires no administrator service, background daemon, or
open inbound port; communication stays inside the existing SSH channel.

## Check the remote environment

After the target reaches `ready`, open **Settings**, then use its
**Environment** and **Providers** categories. Lumora checks remote Node.js, npm,
and only the providers enabled for that target. Results include the resolved
executable path and version when available. **Security** contains the target's
platform, architecture, home directory, shell, and connection controls.

Provider choices belong to the remote target and do not change local provider
settings. At least one provider must remain enabled. Saving a provider selection
starts a new scan, and **Refresh** repeats the scan without reconnecting.

## Browse remote sessions

After the target reaches `ready`, Lumora performs one bounded catalog scan for
the connected shell. **Home** shows recent remote sessions, **Workspaces**
groups them by provider-owned remote paths, and **All sessions** provides the
same search and provider filtering used by local Lumora. **Refresh catalog**
repeats the scan. The catalog includes only read-only metadata: native session
ID, title, timestamps, workspace path, and an all-time token count when the
provider exposes one.

Provider catalog coverage is explicit in the page:

| Provider | Remote catalog status |
| --- | --- |
| Codex | Native app-server thread metadata |
| OpenCode | Bounded database query with native list fallback |
| Claude Code | Bounded provider-owned project recording metadata |
| Gemini CLI | Bounded provider-owned project chat metadata |
| GitHub Copilot CLI | Bounded event or legacy workspace metadata |
| Qwen Code | Bounded provider-owned project recording metadata |

An installed provider with no available executable is shown as unavailable.
Unsupported adapters are not reported as an empty successful catalog. Results
are paginated across bounded helper frames and combined in the main process;
raw session files and transcript contents never cross the SSH helper protocol.
These pages are informational in the current phase and have no Resume action.

The isolated window follows Lumora's global Appearance settings, including the
theme, managed background, opacity hierarchy, and surface mosaic. Appearance
can only be changed in the local window; refocusing an isolated window refreshes
its read-only presentation.

If the SSH transport closes after the shell has opened, Lumora releases the
remote helper and file-transfer resources, marks the target offline, and keeps
the current page and cached catalog visible. An emphasized reconnect banner is
shown instead of replacing the shell with a blank connection page.

Discovery is read-only. Lumora does not install, update, or repair Node.js, npm,
or agent CLIs on the remote computer. Perform those operations on the remote
computer, then refresh the isolated page. The helper uses a fixed command
allowlist, bounded version probes, and never returns environment variables,
tokens, or provider session contents.

## Current states

- `offline`: no active SSH connection.
- `connecting` / `authenticating`: SSH setup is in progress.
- `helper-missing`: authentication succeeded and confirmation is needed.
- `helper-incompatible`: an invalid or incompatible helper can be safely
  replaced after confirmation.
- `ready`: the verified helper completed its protocol handshake.
- `error`: the connection failed safely; credentials and private diagnostics
  are not returned to the renderer.

## Manual test checklist

- Add direct and SSH-config profiles without storing a secret.
- Edit and delete disconnected profiles; confirm open target windows and SSH
  resources close before the profile changes.
- Reject an untrusted or changed host fingerprint.
- Connect each configured authentication method.
- Confirm that Cancel performs no installation.
- Install on a clean account and verify the state becomes `ready`.
- Corrupt a helper copy and verify Lumora requires confirmed replacement.
- Confirm Environment reports remote Node.js/npm paths and versions.
- Enable and disable providers, save, and confirm only enabled providers are
  scanned. Confirm at least one provider must remain enabled.
- Install or remove a provider on the remote computer, refresh, and confirm the
  status changes without reconnecting.
- Confirm a ready connection transitions into the shared Lumora shell with
  Home, Workspaces, All sessions, and Settings, without Terminal profiles or
  local Remote-computer management.
- With each enabled session provider installed, confirm Home recent sessions,
  workspace grouping, All sessions filtering, and Refresh catalog update
  renamed or new sessions.
- Confirm a provider-wide scan failure is shown separately from an unavailable
  executable or a successful empty catalog, without blocking other providers.
- Confirm no transcript text, command output, environment value, or helper-only
  source key appears in the remote window.
- Disconnect from missing, incompatible, and ready states.
- Drop the SSH transport after opening a catalog page and confirm the page and
  cached data remain visible under the reconnect banner.
- Test local/remote OS combinations independently where machines are available.
- Close Lumora and confirm the SSH channel and helper process stop cleanly.
- Change global Appearance settings, refocus the isolated window, and confirm
  its theme and surfaces update without exposing appearance controls remotely.

See [Troubleshooting](TROUBLESHOOTING.md#remote-computers) when a target cannot
reach the ready state.
