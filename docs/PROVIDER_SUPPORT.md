# Provider support and verification

Lumora detects and launches every provider listed below. Support is split into
two levels:

- **Full session support**: new-session launch, provider-owned saved-session
  discovery, catalog display, and exact native resume.
- **Launch only**: detection, configuration, version checking where available,
  and new-session launch. Saved sessions are not imported or resumed.

Every full-session provider can participate in the optional cross-agent
handoff workflow as either source or destination. A handoff creates a new
destination session from a temporary copy; it is not exact native resume.

Codex, Claude Code, and OpenCode additionally support provider-native session
forks. Lumora passes the source session identity and, when supplied, an optional
initial task to the provider; the provider creates and owns the new session.
Without a task, the fork opens ready for input in Lumora's terminal.

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
| Antigravity | Launch only | Pending manual verification | Pending manual verification | Pending manual verification |
| Cursor CLI | Launch only | Pending manual verification | Pending manual verification | Pending manual verification |
| Amp | Launch only | Pending manual verification | Pending manual verification | Pending manual verification |
| Crush | Launch only | Pending manual verification | Pending manual verification | Pending manual verification |
| goose | Launch only | Pending manual verification | Pending manual verification | Pending manual verification |
| Aider | Launch only | Pending manual verification | Pending manual verification | Pending manual verification |

When a combination passes, replace its pending value with the tested Lumora
version, provider version, date, and result. Do not infer one operating system
from another.

## Detection commands

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
