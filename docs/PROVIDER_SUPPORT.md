# Provider support and verification

Lumora detects and launches every provider listed below. Support is split into
two levels:

- **Full session support**: new-session launch, provider-owned saved-session
  discovery, catalog display, and exact native resume.
- **Launch only**: detection, configuration, version checking where available,
  and new-session launch. Saved sessions are not imported or resumed.

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

For launch-only providers, steps 5 and 6 do not apply.

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
