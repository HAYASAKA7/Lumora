# Provider support and verification

Lumora detects and launches every provider listed below. Support is split into
two levels:

- **Full session support**: new-session launch, provider-owned saved-session
  discovery, catalog display, and exact native resume.
- **Launch only**: detection, configuration, version checking where available,
  and new-session launch. Saved sessions are not imported or resumed.

Every full-session provider can be a source for the optional cross-agent
handoff workflow. Kimi Code is source-only because its documented prompt mode
is non-interactive; the other full-session providers can also be destinations.
A handoff creates a new destination session from a temporary copy; it is not
exact native resume.

Codex, Claude Code, and OpenCode additionally support provider-native session
forks. Lumora passes the source session identity and, when supplied, an optional
initial task to the provider; the provider creates and owns the new session.
Without a task, the fork opens ready for input in Lumora's terminal.

OpenCode discovery uses OpenCode's own read-only database command to query only
session metadata (`id`, workspace, title, and timestamps). Lumora does not open
the SQLite file directly or query messages. Older OpenCode versions without the
database command fall back to the structured `session list` command.

## Local Unified UI

Lumora 0.5 can route local new-session and exact-resume launches through a
provider-owned structured interface. This capability is separate from full
session support: catalog discovery still reads provider-owned metadata, and
providers without a verified structured route continue through the native PTY.

| Provider | Structured integration | Local routing | Remote routing |
| --- | --- | --- | --- |
| Codex | App-server protocol | Capability checked; PTY fallback | PTY |
| Claude Code | Claude Agent SDK | Capability checked; PTY fallback | PTY |
| Gemini CLI | ACP (`gemini --acp`) | Capability checked; PTY fallback | PTY |
| OpenCode | ACP (`opencode acp`) | Capability checked; PTY fallback | PTY |
| Cursor CLI | ACP (`cursor-agent acp`) | New sessions when capability check passes; PTY fallback | PTY |
| GitHub Copilot CLI | ACP (`copilot --acp --stdio`) | Capability checked; PTY fallback | PTY |
| Qwen Code | ACP (`qwen --acp`) | Capability checked; PTY fallback | PTY |
| Kimi Code | ACP (`kimi acp`) | Capability checked; PTY fallback | PTY |
| goose | ACP (`goose acp`) | New sessions when capability check passes; PTY fallback | PTY |

Lumora probes the configured executable and version before offering the route.
ACP candidates must complete a protocol-version-1 initialization handshake;
having a similarly named command is not enough. Cursor CLI and goose remain
launch-only catalog providers, so their verified ACP routes can create Unified
UI sessions but Lumora does not present provider-owned saved sessions for exact
resume. Antigravity, Amp, Crush, and Aider remain PTY-only because Lumora does
not have a provider-owned structured protocol for them.
Settings presents one target-scoped Unified UI master switch. Turning it off
forces automatic launches through the native PTY without deleting the saved
per-provider choices. The detailed settings dialog contains capability status,
individual provider switches, and fallback guidance; provider start commands
remain configured once in the installation cards. Opening detailed settings is
what triggers a status refresh. When the master and provider choice are enabled
and verified, a stopped session's context menu can explicitly request
the Unified UI or the native PTY. The explicit PTY choice is scoped to that
launch and does not overwrite the provider preference. An unavailable,
incompatible, failed, or timed-out probe—and a structured launch failure before
ownership is established—falls back to the already validated PTY launch.
Native forks, cross-agent handoffs, and unsupported structured actions remain
PTY-based.

See the [Unified UI guide](UNIFIED_UI.md) for configuration, route selection,
conversation behavior, commands, models, activity, lifecycle, and fallback.

Automated coverage is not a real CLI smoke test. Unit and integration tests
validate Lumora's adapters and command construction, while the operating-system
columns below record hands-on testing with the real provider executable. Leave a
cell pending until that complete check has been performed.

## Release verification matrix

| Provider | Support level | Windows | macOS | Linux |
| --- | --- | --- | --- | --- |
| Codex | Full session support | Pending manual verification | Pending manual verification | Pending manual verification |
| Claude Code | Full session support | Pending manual verification | Pending manual verification | Pending manual verification |
| Gemini CLI | Full session support | Pending manual verification | Pending manual verification | Pending manual verification |
| OpenCode | Full session support | Pending manual verification | Pending manual verification | Pending manual verification |
| GitHub Copilot CLI | Full session support | Pending manual verification | Pending manual verification | Pending manual verification |
| Qwen Code | Full session support | Pending manual verification | Pending manual verification | Pending manual verification |
| Kimi Code | Full session support | Pending manual verification | Pending manual verification | Pending manual verification |
| Antigravity | Launch only | Pending manual verification | Pending manual verification | Pending manual verification |
| Cursor CLI | Launch only | Pending manual verification | Pending manual verification | Pending manual verification |
| Amp | Launch only | Pending manual verification | Pending manual verification | Pending manual verification |
| Crush | Launch only | Pending manual verification | Pending manual verification | Pending manual verification |
| goose | Launch only | Pending manual verification | Pending manual verification | Pending manual verification |
| Aider | Launch only | Pending manual verification | Pending manual verification | Pending manual verification |

When a combination passes, replace its pending value with the tested Lumora
version, provider version, date, and result. Do not infer one operating system
from another.

## Cross-device transfer verification

Cross-device transfer has a separate verification matrix from saved-session
support. Routes that pass the exact provider-version and operating-system
matrix are marked **Supported**. Implemented routes that have not completed the
matrix are available as **Experimental** in packaged and development builds so
users can opt into them with clear status. Unit tests or a successful
same-device run still do not make an experimental route verified.

| Provider | Transfer adapter | Export | Same-OS import | Cross-platform import |
| --- | --- | --- | --- | --- |
| OpenCode | Implemented; native structured export/import | Verification pending | Verification pending | Verification pending |
| Codex | Implemented; native rollout plus prompt-free app-server fork | Verification pending | Verification pending | Verification pending |
| Claude Code | Implemented; native transcript and companion session data | Verification pending | Verification pending | Verification pending |
| Gemini CLI | Implemented; native session-file import | Verification pending | Verification pending | Verification pending |
| GitHub Copilot CLI | Implemented; native session-state directory | Verification pending | Verification pending | Verification pending |
| Qwen Code | Implemented; native project chat JSONL | Verification pending | Verification pending | Verification pending |
| Kimi Code | Implemented; native session directory and append-only index | Verification pending | Verification pending | Verification pending |

The seven implemented adapters are reported as **Experimental** until native
packaged tests record evidence for their exact routes. Experimental routes are
selectable in release and development builds without altering the verification
matrix. Unimplemented combinations remain **Not verified** and unavailable.
See the [cross-device transfer guide](SESSION_TRANSFER.md) for user steps,
archive boundaries, and safety guidance.

For every provider route proposed for release:

1. build and verify packaged Lumora on the native source and destination
   operating systems;
2. create and stop a uniquely identifiable provider session;
3. export it from packaged Lumora, transfer the archive, and import it;
4. verify the provider discovers exactly one session with the expected native
   identity or provider-generated import identity, mapped workspace, and title;
5. resume it using that provider and confirm its context;
6. repeat with a duplicate and confirm no provider data is overwritten;
7. repeat with the provider missing or disabled and confirm no native write occurs;
   and
8. record the provider version, source and destination platforms, Lumora commit,
   timestamp, and result.

Only passing literal records may be added to the verified route table. Evidence
for one provider version or operating-system pair never enables another.

After all checks pass, use the release recorder rather than editing the table:

```powershell
node scripts/release/record-transfer-verification.cjs --provider <provider> --source win32 --destination linux --version <provider-version> --commit (git rev-parse HEAD)
```

Replace the platform values with the exact tested route. See
[Releasing Lumora](RELEASING.md#enable-a-verified-transfer-route) for the commit
and rebuild requirements.## Detection commands

Lumora uses these commands to identify an installed provider:

| Provider | Version command |
| --- | --- |
| Codex | `codex --version` |
| Claude Code | `claude --version` |
| Gemini CLI | `gemini --version` |
| Antigravity | `agy --version` |
| OpenCode | `opencode --version` |
| Cursor CLI | `cursor-agent --version` |
| GitHub Copilot CLI | `copilot version` |
| Qwen Code | `qwen --version` |
| Kimi Code | `kimi --version` |
| Amp | `amp --version` |
| Crush | `crush --version` |
| goose | `goose --version` |
| Aider | `aider --version` |

A custom start command can wrap the detected executable, but detection still
requires the provider command or a saved manual executable path.

## Native fork commands

| Provider | Minimum tested version | Arguments after the configured provider command |
| --- | --- | --- |
| Codex | `0.120.0` | `fork <session-id> [task]` |
| Claude Code | `1.0.90` | `--resume <session-id> --fork-session [task]` |
| OpenCode | `1.0.0` | `--session <session-id> --fork [--prompt <task>]` |

Lumora only offers native fork when the installed version is at or above the
tested minimum. An older or unparseable version can still use its other
supported Lumora features, but native fork remains hidden and is rejected by
the launch service.

## Manual provider checklist

For every provider and target operating system:

1. Install and authenticate the real CLI using its official instructions.
2. Open **Settings > Providers**, refresh, and confirm the executable and
   version are detected correctly.
3. Start a session in a disposable workspace, enter a prompt, and exit.
4. Confirm the managed terminal closes and Lumora refreshes without restarting.
5. For a provider with full session support, confirm the session appears under
   the correct workspace with the correct provider and title.
6. Resume that exact session, verify its context in the provider, exit, and
   confirm the catalog refreshes again.
7. Repeat the launch with a custom provider command or shell wrapper.
8. For Codex, Claude Code, and OpenCode, fork the saved session once without an
   initial task and once with one; confirm each new native session contains the
   source context, receives a distinct identity, and leaves the original
   resumable.
9. Enable cross-agent handoff, choose a different installed full-session
   provider in the resume dialog, and confirm that a new destination session
   receives the conversation while the source still resumes normally.
10. Use a non-English source conversation and confirm the destination continues
   in the user's language rather than Lumora's English bootstrap language.

For launch-only providers, steps 5, 6, 8, 9, and 10 do not apply. Native fork
step 8 only applies to Codex, Claude Code, and OpenCode.

## Why some providers are launch-only

Lumora only imports provider-owned sessions when it has a stable source format
and a reliable exact-resume command. Cursor CLI exposes `cursor-agent ls` and
resume options, but its documented list output is human-oriented rather than a
stable structured session export. Antigravity exposes resume options, while
`last_conversations.json` is only a cache of the most recent conversation for
each workspace rather than a complete history source.

Amp, Crush, goose, and Aider also remain launch-only until a stable, documented
session source and exact native resume path are implemented and tested. Lumora
does not guess from terminal output or present partial discovery as full
support.
