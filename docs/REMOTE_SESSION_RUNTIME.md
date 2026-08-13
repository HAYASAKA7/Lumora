# Remote session runtime design

## Outcome

Remote Lumora must provide the same usable session workflow for every provider
with complete session management: Codex, Claude Code, Gemini CLI, OpenCode,
GitHub Copilot CLI, Qwen Code, and Kimi Code. A connected Windows, macOS, or Linux target
can start a new provider session or resume an exact provider-owned session in a
native interactive terminal inside the isolated remote Lumora window.

The feature is complete only when all seven providers share the remote runtime
path and every remote-platform branch has automated coverage. Manual acceptance
uses any available target/provider combination; it is not the product scope.

## Runtime boundary

The existing SSH connection opens a separate PTY-backed exec channel for each
remote terminal. The lightweight Go helper remains responsible for bounded
environment, provider, and session discovery; it does not become a daemon or a
PTY broker. This keeps the helper small and delegates terminal allocation to
the remote SSH server on all supported operating systems.

The Electron main process owns remote runtime state, launch tokens, workspace
trust, SSH PTY channels, output buffers, and shutdown. The sandboxed renderer
uses the existing validated terminal API and cannot provide an execution target,
an executable path, a workspace path, or a native session identity as launch
authority. Those values are resolved again from the authorized remote target's
latest discovery and catalog state.

## Launch preparation

Remote catalog scans persist target-scoped workspace and session metadata in
Lumora's existing catalog tables. Remote provider scans supply the current,
absolute executable path and version. Launch preparation accepts the existing
new/resume request schema and then:

1. resolves the execution target from the sender window context;
2. refreshes the remote catalog and provider discovery when required;
3. verifies the provider is enabled, installed, session-managed, and ready;
4. resolves a workspace or exact native session from target-scoped catalog
   state;
5. builds arguments through the shared provider launch-command module;
6. creates a short-lived target-scoped launch token and preview;
7. requires trust for the exact remote workspace path before token consumption.

Cross-agent handoff and native fork are not silently mapped onto resume in this
phase. They remain unavailable remotely until their separate remote file and
lifecycle semantics are implemented. New session and exact same-provider resume
are complete for all seven managed providers.

## Cross-platform command execution

Provider executable paths and arguments stay structured until the last SSH
boundary. A focused command builder performs the unavoidable remote-shell
encoding:

- macOS and Linux use strict POSIX single-argument quoting, change to the
  validated workspace, and `exec` the discovered executable;
- Windows invokes Windows PowerShell with literal-path and literal-argument
  encoding so `.exe`, `.cmd`, `.bat`, and `.ps1` provider installations work
  without interpolating renderer text;
- NUL, control-line characters, oversized values, relative executable paths,
  and unsupported platforms are rejected before opening a channel.

Tests cover spaces, quotes, shell metacharacters, Unicode, prompts, native
session IDs, and Windows/macOS/Linux path forms. No local environment value or
provider credential is copied to the remote process by Lumora.

## PTY and lifecycle

The SSH adapter exposes a narrow PTY channel with input, resize, output, exit,
and termination operations. The existing runtime host remains responsible for
bounded snapshots, sequenced output events, late-write suppression, state
transitions, and the two-interrupt-then-terminate shutdown policy. Remote PTYs
have no trustworthy numeric process ID, so runtime summaries keep `pid` null.

Runtime events are tagged with their execution target inside the main process
and delivered only to the corresponding isolated window. Local terminal events
continue to reach only the local window. Disconnect, profile mutation, app
shutdown, transport loss, repeated close, late output, and undefined exit codes
must be safe and idempotent.

## Renderer reuse

Remote Lumora reuses the established New Session dialog, Resume Session dialog,
managed xterm viewport, terminal tabs, details dialog, appearance hierarchy,
clipboard behavior, link handling, and stop workflow. These components receive
a narrow terminal API dependency whose default is `window.lumora`; no second
terminal UI or remote-only visual system is introduced.

The remote Home, workspace detail, and All Sessions views expose new/resume
actions when the corresponding provider is ready. Starting a runtime opens the
terminal surface without unmounting catalog pages or sibling terminals. Tabs
remain mounted across navigation, resize with the remote window, and close after
the runtime exits under the same policy as local Lumora.

## Verification

The implementation uses red-green-refactor tests at these boundaries:

- SSH PTY allocation, input, resize, exit, termination, timeout, and late events;
- safe command construction for Windows, macOS, and Linux;
- new/resume arguments for all seven managed providers;
- target-scoped preparation, trust, token consumption, and stale-catalog checks;
- local/remote IPC authorization and runtime-event isolation;
- preload parsing and terminal component API injection;
- remote new-session, resume, tabs, terminal mounting, stop, exit, and reconnect
  behavior;
- full `npm run verify` completion gate.

Manual verification must demonstrate both new session and exact resume in the
remote window, interactive input/output, resize, tab switching, stop/exit,
catalog refresh, and clean disconnect. Native checks should be repeated on each
available remote OS before the feature loses its experimental label.
