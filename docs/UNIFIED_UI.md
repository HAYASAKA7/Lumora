# Lumora Unified UI

Lumora 0.5 adds a local chat-style interface for providers that expose a
structured protocol. It complements the native terminal; it does not replace
provider-owned sessions, authentication, permissions, or the terminal fallback.

Remote Lumora remains PTY-based in 0.5. The settings and capability results in
this guide apply only to local Lumora.

## Supported integrations

| Provider | Integration | Unified UI route |
| --- | --- | --- |
| Codex | App-server protocol | New session and exact resume |
| Claude Code | Claude Agent SDK | New session and exact resume |
| Gemini CLI | ACP | New session and exact resume |
| OpenCode | ACP | New session and exact resume |
| Cursor CLI | ACP | New sessions |
| GitHub Copilot CLI | ACP | New session and exact resume |
| Qwen Code | ACP | New session and exact resume |
| Kimi Code | ACP | New session and exact resume |
| goose | ACP | New sessions |

Cursor CLI and goose remain launch-only catalog providers, so Lumora can open
a verified new Unified UI session but does not claim provider-owned saved-session
discovery or exact resume for them. Antigravity, Amp, Crush, and Aider remain
native-terminal-only.

The current executable and provider version must pass Lumora's capability
check. An installed command name alone does not verify a structured route.

## Enable Unified UI

The **Unified agent interface** master switch is off out of the box. Open
**Settings > Providers** and turn on the target-scoped switch to use it. The
switch belongs to one target, so a remote computer is turned on separately.

<p align="center">
  <img src="screenshots/0.5/unified-ui/unified_ui_settings.png" alt="Lumora Providers settings with the Unified agent interface master switch" width="1100">
</p>

With the switch on, select **Detailed settings** to check the installed
interfaces and choose providers individually. The entry appears only while the
master switch is on, because everything inside it applies to an interface that
is otherwise not in use. Provider start commands remain in their installation
cards; Lumora does not duplicate them in the Unified UI dialog.

Opening the dialog reads the providers Lumora has already detected and asks
each one that is turned on what it supports, by launching its own interface and
holding a short conversation with it. A provider's answer is kept until its
installation changes, and a failed check is tried again after half a minute;
**Check interfaces** discards them and looks again from scratch. A provider
turned off here is not asked at all, and reports **Native terminal fallback**
until you turn it on.

<p align="center">
  <img src="screenshots/0.5/unified-ui/unified_ui_switch_dialog.png" alt="Lumora Unified UI detailed settings with per-provider capability results" width="920">
</p>

Turning off the master switch forces automatic launches through the native PTY
without deleting the saved per-provider choices.

## Open a session

Select a supported saved session normally. Lumora begins the direct resume flow
immediately, keeps preparation inside the terminal workspace, and leaves other
pages usable while the provider connects.

Opening a session checks only that session's agent, so it never waits for the
other agents to answer. The first time Codex or an ACP agent opens after it is
installed or updated, Lumora asks it what it supports once; later sessions reuse
that answer. Shortly after Lumora starts, it prepares that answer in the
background for the agents you opened in Unified UI during the last two weeks.

When a session is already active, Lumora returns to its existing runtime rather
than opening a second writer. For a stopped session, right-click to explicitly
choose **Open in Unified UI**, **Open in native terminal**, or **Resume
options…**. The explicit native-terminal route changes only that launch.

If a capability check or structured launch fails before ownership is
established, Lumora falls back to the validated native terminal route. Native
forks, cross-agent handoffs, and structured actions a provider does not expose
remain PTY-based.

## Conversation workspace

The Unified UI renders provider responses as Markdown and keeps the provider
name and turn state with each agent message. The composer remains independent
from conversation height and keeps focus after sending.

<p align="center">
  <img src="screenshots/0.5/unified-ui/unified_ui_conversation.png" alt="Lumora Unified UI conversation with Markdown, model selector, composer, and session sidebar" width="1100">
</p>

During a turn, the status changes to Running and a stop control appears beside
Send. Cancelling requests provider cancellation through the structured
transport; it does not terminate the whole Lumora application.

You can keep writing while the agent works. **Codex** takes a message into the
turn under way, and the conversation shows it beneath the prompt as sent while
Codex was working. **Claude Code** and **ACP agents** take one message at a
time, so Lumora holds yours above the message box, marked as waiting, and sends
it when the turn ends — also when you stop the turn, which is the quickest way
to redirect an agent that has gone the wrong way. Several waiting messages go
one turn at a time, and a waiting message can be removed before it is sent. A
command waits for the turn to end rather than being sent into it, and so does
a message sent during a Codex review or compaction, which cannot take one. A
waiting message that cannot be sent is marked **Not sent** and stays until you
send it again or remove it.

<p align="center">
  <img src="screenshots/0.5/unified-ui/unified_ui_running.png" alt="A running Lumora Unified UI turn with process activity and the stop control" width="1100">
</p>

Lumora follows new output while the user remains at the latest content. If the
user scrolls upward, automatic following pauses so earlier content stays in
place. Long sessions initially load a small, content-bounded recent window;
scrolling upward progressively requests earlier turns instead of rendering the
entire transcript at once.

### Images

One attach control sits at the left of the message box. For an agent that
reads images it opens a menu offering **Attach images** or **Attach files**;
for one that does not, it goes straight to files.

Paste a screenshot, drop pictures on the message box, or choose **Attach
images**. Up to eight go with one message, and a message can be images
alone. Lumora
accepts PNG, JPEG, GIF, and WebP. It scales each image so its longest side is at
most 2048 pixels, then sends it as PNG, or as JPEG when a photo would be too
large as PNG. Each thumbnail can be removed before sending. The conversation
records how many images a message carried; it does not keep the pictures.

Codex and Claude accept images. An ACP agent accepts them only when it says so
at startup, as Gemini CLI does; for any other agent the button does not appear.

### Files

Every session can attach files, and the message box takes dropped files. A
file goes to the agent as its path, not its contents: agents read files with
their own tools, so a path lets the agent open what it needs, search a large
file, or come back to it later, and it costs nothing until the agent reads it.
Up to eight files go with one message, and a message can be files alone.

The paths are part of the message, so the conversation shows exactly what the
agent was told. Whether the agent can open a file is its own decision: a file
in the session's workspace is ordinary, while one outside it follows the
agent's own rules and may raise an approval request or be refused.

## Commands and models

Type `/` to open the provider's available command list. Lumora shows commands
advertised by the active integration rather than inventing a shared command
language. Command results remain provider-owned structured events.

<p align="center">
  <img src="screenshots/0.5/unified-ui/unified_ui_command_center.png" alt="Lumora Unified UI provider command list with the active command highlighted" width="1100">
</p>

When the provider exposes model configuration, use the selector inside the
composer. A successful change applies to future turns and is reconciled with
the provider state when the session is resumed.

When the agent can change how it works, a **Mode** picker sits at the left of
the message box, beside the attach button:

- **Codex** offers **Default** and **Plan**. Plan mode can be left the same way
  it was entered, and `/plan` with a request still switches to plan and starts
  on it. `/permissions` shows which permission profile is in use.
- **Claude Code** offers **Default**, **Accept edits**, and **Plan**. Lumora never
  switches Claude into bypassing permissions; a session already in another
  mode shows it until you choose one of these.
- **ACP agents** show the modes they advertise, such as Gemini CLI's.

When the agent changes mode itself — Claude leaving plan mode once you approve
its plan, for example — the picker follows. The mode can be changed between
turns, the same as the model.

<p align="center">
  <img src="screenshots/0.5/unified-ui/unified_ui_model_selector.png" alt="Lumora Unified UI model selector inside the message composer" width="1100">
</p>

Not every provider exposes the same models, commands, reasoning controls, or
account information. Lumora hides unavailable controls instead of presenting
an unsupported imitation.

## Process, tools, approvals, and file changes

Provider commands, tool calls, approvals, and related operations share the
collapsible **Process** entry. Agent messages remain in the conversation while
implementation activity can be expanded only when needed.

An agent's plan appears there as a checklist that updates as the work moves on:
Codex's plan, and Claude Code's to-do list, in place of the tool call Claude
uses to write it. When either agent compacts its context to make room, the
process shows that too.

<p align="center">
  <img src="screenshots/0.5/unified-ui/unified_ui_activity.png" alt="Lumora Unified UI showing expanded provider tool activity during a running turn" width="1100">
</p>

When a provider reports changed files, Lumora presents its structured file
changes and diffs without reading arbitrary workspace files from the renderer.
Approval requests stay associated with the provider turn and must be answered
before the provider continues.

The session header also carries a **Changes** button. It does not belong to one
turn: it opens Lumora's own list of every file that changed in the workspace
since the session started, however it was changed, with the diff beside it.
See [Review changes](USER_GUIDE.md#review-changes).

### Questions from the agent

An agent sometimes needs something from you before it can go on: Codex asking
which option you want, Claude Code's multiple-choice questions, or an MCP
server that needs a short form filled in or a sign-in page visited. Lumora
shows the question in the conversation. Choose an option, type an answer, or
open the page, then select **Answer** (or **Done**) or **Decline**.

Answers go only to the agent. The conversation records that a question was
answered or declined, never the answer itself, so a token you paste stays out
of the session history, and a secret field hides what you type. A question the
agent no longer needs — its turn ended, or it withdrew the question — closes on
its own. A form Lumora cannot show faithfully, such as one with nested fields,
is declined for you rather than half-answered.

When Codex asks for more permissions than its sandbox gives, such as network
access or another folder, the request uses the same approval buttons as a
command, and allowing it grants exactly what was asked.

## Session details

Select **Session details** to inspect normalized metadata such as provider,
native session identity, timestamps, token totals, context, and subscription
usage when available. The details surface does not parse terminal text to guess
missing provider data. Codex's subscription limits stay current as it reports
them during the session, without reopening the details.

### When something goes wrong

An error from the agent says what kind of problem it is in your language — a
usage limit, too many requests, a conversation too long for the context, an
overloaded service, a lost connection, a sign-in that expired, an account or
billing problem, or a refused request — with the agent's own words beneath it
when it gave any. A request the agent is retrying shows which attempt it is on,
and a usage limit shows when it resets if the agent reported that.

An error clears itself once the agent gets past it: the failed turn completes,
the agent answers after a retry, or a later turn gets an answer. A usage limit
or a refusal stays until the agent is heard from again, so it is still there
when you come back to the session, and running a command such as `/status`
does not clear it.
A turn you stop yourself is not reported as a failure.

<p align="center">
  <img src="screenshots/0.5/unified-ui/unified_ui_session_details.png" alt="Lumora Unified UI session details with provider metadata and token usage" width="900">
</p>

## Lifecycle and fallback

- Closing a loading surface cancels its pending structured launch and any late
  native-terminal fallback.
- Closing an active Unified UI session asks the provider runtime to exit and
  releases its one-writer ownership.
- A first-response, command, or reconnect failure is handled inside the session
  view without blocking navigation elsewhere in Lumora.
- If the provider integration is unavailable, incompatible, disabled, timed
  out, or fails before it owns the session, Lumora uses the native PTY.
- Selecting an already-running session always returns to the current Lumora
  runtime, regardless of where its card was selected.

For provider-specific status and manual verification, see
[Provider support and verification](PROVIDER_SUPPORT.md). For terminal fallback
behavior, see [Using Lumora](USER_GUIDE.md#managed-native-terminals).

## Security boundary

Structured provider processes and session data stay in Electron's main process
behind schema-validated IPC, bounded transports, expiring launch tokens,
capability checks, workspace trust, workspace-confined file access, and
one-writer session ownership. The sandboxed renderer receives normalized
events rather than direct process or filesystem access.

Images reach the main process as bytes, and it checks them again. It stores only
a PNG or JPEG that decodes and fits the size limits, in a temporary folder of
the session's own, and removes that folder when the session closes. The renderer
holds an opaque token for each stored image, never a path, and only the session
that stored an image can send it.
