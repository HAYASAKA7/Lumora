# Remote computers

Remote computers are an experimental Lumora feature. The current phase creates
an isolated remote window, verifies SSH identity, detects the remote platform,
installs and negotiates a lightweight Lumora helper, and checks the remote
developer environment and enabled agent providers. Its isolated **Sessions**
page can also read supported provider-owned session metadata. Remote resume,
launch, and terminal execution are not available yet.

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

## Full remote shell design

The isolated target page is a connection gate, not the permanent remote user
interface. Before a target is ready, it owns host verification, credentials,
connection progress, helper inspection, and confirmed helper installation.
After the helper handshake succeeds, the same window transitions into Lumora's
existing application shell instead of rendering a separate card-style app.

The remote shell reuses the local shell's sidebar, top bar, scrolling content
region, status bar, appearance presentation, responsive layout, cards, and
catalog views. Target mode supplies a scoped route manifest and data adapter;
it does not copy or fork the visual components. This keeps local and remote UI
fixes aligned.

Remote primary navigation contains:

- **Home** for target status and recent remote sessions.
- **Workspaces** for provider-owned workspace groupings on that computer.
- **All sessions** for the target-scoped session catalog.
- **Settings** for remote-capable configuration only.

**Terminal profiles** and local remote-computer management are omitted. The
remote settings manifest can contain **Providers**, **Environment**,
**Launch**, **Security**, and **Transfer**, but it exposes a category only when
the target-scoped backend for that category is functional. The first shared
shell therefore includes Providers, Environment, and connection Security;
Launch and Transfer appear with their remote execution and file-operation
phases rather than as empty placeholders. Categories that would only mutate the
local Lumora installation are not shown. Global appearance remains controlled
by the local window and is applied read-only to every remote shell.

All remote routes use the execution target ID bound to the BrowserWindow by the
main process. Renderer requests cannot select another target, enumerate local
catalog data, or call local-only mutation APIs. Remote helper responses are
normalized into the same view models consumed by existing Lumora cards while
remaining target-scoped.

If SSH or the helper disconnects after the shell is visible, Lumora keeps the
current route and last bounded catalog snapshot on screen. A prominent
enhanced-color reconnect banner marks the data as stale, blocks remote
mutations, and provides the primary **Reconnect** action. Successful
reconnection dismisses the banner and refreshes the active route. Authentication
or helper confirmation can reopen inside the connection workflow without
discarding the shell's navigation state.

The remote window must occupy its complete BrowserWindow and use the shell's
single scrolling content region. Connection-gate content may scroll within the
full window when its contents exceed the available height; it must not be
presented as a fixed, clipped component.

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

After the target reaches `ready`, use the isolated window's **Environment** and
**Providers** pages. Lumora checks remote Node.js, npm, and only the providers
enabled for that target. Results include the resolved executable path and
version when available.

Provider choices belong to the remote target and do not change local provider
settings. At least one provider must remain enabled. Saving a provider selection
starts a new scan, and **Refresh** repeats the scan without reconnecting.

## Browse remote sessions

Open **Sessions** after the target reaches `ready`. Lumora starts this scan only
when the page is opened or its **Refresh** button is selected, so connecting a
computer does not also trigger a potentially large session scan. Results are
grouped by the provider's remote workspace path and include only bounded,
read-only metadata: native session ID, title, timestamps, workspace path, and
an all-time token count when the provider exposes one.

Provider catalog coverage is explicit in the page:

| Provider | Remote catalog status |
| --- | --- |
| OpenCode | Metadata discovery through the provider CLI |
| Codex, Claude Code, Gemini CLI, GitHub Copilot CLI, Qwen Code | Adapter pending; shown as **Catalog support pending** |

An installed provider with no available executable is shown as unavailable.
Unsupported adapters are not reported as an empty successful catalog. Results
are paginated across bounded helper frames and combined in the main process;
raw session files and transcript contents never cross the SSH helper protocol.
This page is informational in the current phase and has no Resume action.

The isolated window follows Lumora's global Appearance settings, including the
theme, managed background, opacity hierarchy, and surface mosaic. Appearance
can only be changed in the local window; refocusing an isolated window refreshes
its read-only presentation.

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
- Open Sessions and confirm the scan begins only after opening the page.
- With OpenCode installed, confirm sessions are grouped by the remote workspace
  path and Refresh updates renamed or newly created sessions.
- Confirm enabled catalog providers without an implemented adapter show
  **Catalog support pending**, rather than a misleading empty result.
- Confirm no transcript text, command output, environment value, or helper-only
  source key appears in the remote window.
- Disconnect from missing, incompatible, and ready states.
- Test local/remote OS combinations independently where machines are available.
- Close Lumora and confirm the SSH channel and helper process stop cleanly.
- Change global Appearance settings, refocus the isolated window, and confirm
  its theme and surfaces update without exposing appearance controls remotely.

See [Troubleshooting](TROUBLESHOOTING.md#remote-computers) when a target cannot
reach the ready state.
