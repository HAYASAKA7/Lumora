# Troubleshooting Lumora

Use this guide when Lumora cannot detect a provider, display a saved session,
or operate a managed terminal as expected. Start with the quick checks, then
open the section that matches the symptom.

Each entry follows the same format:

- **Symptom:** what the user sees;
- **Likely cause:** the most common explanation;
- **Resolution:** safe steps to diagnose or correct it.

Lumora is an unsigned MVP. Some platform warnings and runtime limitations are
expected and are documented below.

## Quick checks

1. Open **Settings > Environment** and confirm Node.js and npm are detected.
2. Open **Settings > Providers**, select **Refresh**, and check the provider's
   status, version, and command path.
3. Run the provider's version command in the same shell environment used by
   Lumora.
4. Refresh the workspace or session catalog after the provider finishes writing
   its session data.
5. Confirm that the selected terminal profile loads any alias, wrapper, or shell
   profile required by the launch command.

## Installation and startup

### Windows or macOS blocks Lumora

**Symptom:** Windows SmartScreen warns about the installer, or macOS Gatekeeper
blocks the DMG or application.

**Likely cause:** Lumora MVP packages are not code-signed or notarized.

**Resolution:** Download packages only from
[Lumora GitHub Releases](https://github.com/HAYASAKA7/Lumora/releases). Verify
the filename and source. On Windows, use the SmartScreen details only after that
verification. On macOS, use **System Settings > Privacy & Security > Open
Anyway** after verifying the package.

### Linux AppImage does not open

**Symptom:** Opening the AppImage does nothing or reports a permission error.

**Likely cause:** The downloaded file is not executable.

**Resolution:** Make it executable, then start it again:

```bash
chmod +x Lumora-*.AppImage
```

### Lumora reports that Node.js or npm is missing

**Symptom:** The startup notice or **Settings > Environment** reports a missing
Node.js or npm installation.

**Likely cause:** Node.js is not installed, or its installation directory is not
available on `PATH`.

**Resolution:** Use Lumora's **Download Node.js** action to open the official
download page. Install Node.js yourself, restart Lumora, and refresh the
environment check. Lumora does not install Node.js automatically.

## Provider discovery

### A provider is not detected

**Symptom:** An installed agent appears as missing or unavailable in
**Settings > Providers**.

**Likely cause:** The executable is not on `PATH`, the command name differs from
Lumora's default, or its version probe is incompatible.

**Resolution:** Select **Refresh** on **Settings > Providers**, which re-probes
every enabled provider rather than reusing the last result. If the provider is
still missing, run its version command in a normal terminal and confirm that it
succeeds. If the executable uses a nonstandard path or wrapper, configure the
provider command under **Settings > Launch**.

A scan that missed a provider is recorded in the diagnostic journal with the
number of providers detected, missing, and failed to probe, so a detection that
fails intermittently leaves a trace to look back at. A version check that fails
is tried once more; the journal then records a `provider · version-check`
event naming the provider and whether its check timed out or failed.

### An alias or wrapper command does not start

**Symptom:** The command works in an interactive shell but Lumora reports that
it cannot be resolved or launched.

**Likely cause:** The selected terminal profile does not load the shell profile
that defines the alias or wrapper.

**Resolution:** Create or select a terminal profile for the shell that defines
the command, including any startup arguments required to load its profile. Set
the custom provider command under **Settings > Launch**, then review the launch
preview before starting the session.

### Install or update is unavailable

**Symptom:** A provider card offers an official guide instead of a one-click
install or update action.

**Likely cause:** Lumora only runs allowlisted npm installation commands.
Providers with another installation method intentionally use their official
guide.

**Resolution:** Open the provider's guide from its Settings card and follow the
provider's instructions. Restart Lumora and refresh provider discovery after
installation.

## Workspaces and saved sessions

### A saved session is missing

**Symptom:** A session created by a provider does not appear on Home, in a
workspace, or under **All sessions**.

**Likely cause:** The provider is not installed, the provider is launch-only,
the session is still being written, or the catalog has not refreshed.

**Resolution:** Confirm the provider supports saved-session discovery in the
[supported provider table](../README.md#supported-providers). Let the provider
finish writing, then refresh the catalog. Launch-only providers do not appear in
saved-session lists or filters.

### A cross-agent handoff cannot be prepared

**Symptom:** The destination provider is absent from the resume dialog, or the
handoff fails before its terminal starts.

**Likely cause:** Cross-agent handoff is disabled, either provider is disabled
or unavailable, the source provider is still writing the session, or Lumora
cannot create a stable bounded copy of that provider version's session data.

**Resolution:** Enable the feature in **Settings > General**, enable both
providers, confirm that both are installed and have full session support, let
the source session finish writing, then refresh and retry. Exact native resume
remains available because a failed handoff does not modify the source.

### A workspace does not appear

**Symptom:** A project directory is absent from the Workspaces page.

**Likely cause:** No supported provider session has registered that workspace,
or the directory has not been added manually.

**Resolution:** Select **Add workspace** and choose the project directory. If it
was already added, refresh Workspaces and confirm the directory still exists
and is accessible to your user account.

### A session warning returns after refresh

**Symptom:** A dismissed provider warning appears again after Lumora restarts or
the catalog changes.

**Likely cause:** Warning dismissal is a current-view convenience, while the
underlying provider data is still invalid or incomplete.

**Resolution:** Close the provider cleanly, allow it to finish writing its
session metadata, and refresh again. If the warning continues, collect its full
message before reporting the issue.

## Cross-device session transfer

### A session cannot be selected for export

**Symptom:** The session checkbox or provider-wide selection is disabled.

**Likely cause:** The session is running or stale, the provider is unavailable,
or the provider/version/operating-system route is not implemented.

**Resolution:** Stop the provider session, refresh the catalog and provider
status, then open **Settings > Transfer**. Routes marked **Experimental** are
selectable with caution; routes shown as **Not verified** are unavailable.

### An archive password is rejected

**Symptom:** Lumora cannot inspect an encrypted `.lumora-sessions` archive.

**Likely cause:** The password is incorrect, the file was modified or truncated,
or the selected file is not a Lumora session archive.

**Resolution:** Retry with the exact export password and an unchanged copy of
the archive. Lumora cannot recover the password. Re-export from the source
device if the archive may be damaged. Do not disable integrity checks or extract
the provider payload manually.

### A provider in the archive cannot be selected

**Symptom:** A provider is listed during import but remains disabled.

**Likely cause:** The provider is not installed, is disabled in General
settings, requires an update, or its source-to-destination route is not verified.
The environment check is independent from archive inspection.

**Resolution:** Install and authenticate the provider, enable it under
**Settings > General**, refresh **Settings > Providers**, and check **Settings >
Transfer** again. You can import supported providers now and retry the skipped
provider later from the same mixed-provider archive.

### A source workspace cannot be mapped

**Symptom:** The source path does not exist on this device, or Lumora does not
suggest the correct destination workspace.

**Likely cause:** Workspace roots differ between Windows, macOS, and Linux, or
more than one local workspace has similar mapping evidence.

**Resolution:** Create or copy the project directory outside Lumora first. In
the mapping step, choose an existing Lumora workspace or select **Add
workspace** and register that existing directory. Lumora does not create project
directories or transfer workspace files. Leave the source on **Skip this
workspace** if no safe destination exists.

### An import completes with skipped or failed sessions

**Symptom:** The result is partial, contains duplicates, or stops later sessions
for one provider.

**Likely cause:** Native session IDs already exist, a provider changed after the
review step, a workspace became unavailable, or the provider could not verify a
native import. After a fatal provider error, Lumora blocks later writes for that
provider while allowing independent providers to finish.

**Resolution:** Read the result summary, correct the provider or workspace, and
open the unchanged archive again. Duplicate sessions are intentionally skipped
and must not be overwritten. A failed verified import is rolled back when the
provider supports rollback; confirm the provider is healthy before retrying.
## Managed terminals

### Copy or paste does not behave as expected

**Symptom:** `Ctrl+C` interrupts instead of copying, or clipboard text or an
image is not pasted into the terminal.

**Likely cause:** No terminal text is selected, or the platform-specific
clipboard shortcut was not used.

**Resolution:** On Windows and Linux, use `Ctrl+Shift+C` and `Ctrl+Shift+V` for
unambiguous copy and paste; `Ctrl+V` also pastes. With selected text, `Ctrl+C`
copies. On macOS, use `Command+C` and `Command+V`. On every platform,
right-click inside a live terminal to paste supported clipboard contents.

When the clipboard contains an image, the same paste actions insert a
`[Pasted image: "..."]` reference. Lumora does not submit it automatically.
If staging fails, confirm that the terminal is still running, the image is no
larger than 8192 px on either side, and its PNG representation is below 20 MiB.
For a remote terminal, also confirm that its SSH connection is still online.

### The first Ctrl+C does not interrupt the provider

**Symptom:** Pressing `Ctrl+C` once with no selected text shows an interrupt
notice but does not stop the running operation.

**Likely cause:** Lumora guards against accidental interrupts.

**Resolution:** Press `Ctrl+C` a second time while the notice is visible to stop
the managed runtime. Any other terminal key clears the armed interrupt.

### Codex remains open after /exit or /quit

**Symptom:** Codex begins exiting, but its terminal tab remains open.

**Likely cause:** The Codex process completed its own cleanup but remained
attached to the platform PTY.

**Resolution:** Wait briefly. Lumora gives Codex time to exit normally, then
closes the still-attached runtime. The same behavior applies when Codex is idle
or running a workflow.

### A terminal tab closes by itself

**Symptom:** A terminal tab disappears after the agent stops.

**Likely cause:** This is expected behavior. Lumora automatically closes a tab
when its managed provider process exits and refreshes the catalog.

**Resolution:** Resume the saved session or start a new one if more work is
needed. Report the problem only if the provider process is still running.

### A Unified UI session stays on Starting for a long time

**Symptom:** Opening or resuming a session in Unified UI shows **Starting** for
15 seconds or more, whether or not the session holds images or a long history.

**Likely cause:** Fixed in 0.5.13. Earlier versions asked every installed
Unified UI agent what it supports before opening any session, and asked again
once the answers were five minutes old.

**Resolution:** Update Lumora. The first session of Codex or an ACP agent after
installing or updating it still waits for that agent's own check once. If
sessions stay slow, look in **Settings > Diagnostics** for `provider ·
version-check` events naming a provider whose check times out.

### A provider process is still running after Lumora closes

**Symptom:** An agent process — `node` running gemini, codex or another CLI —
is still in Task Manager after Lumora has exited.

**Likely cause:** Fixed in 0.5.8. On Windows an agent installed by npm starts
through a `.cmd` shim, so earlier versions ended the shim and left the agent it
had launched running. A capability check that failed or timed out was the usual
way to produce one.

**Resolution:** End the process once from Task Manager; 0.5.8 and later take
down everything a provider started. If a new one appears on 0.5.8 or later,
report it with the provider name and how the session or check ended.

### A runtime cannot be restored after restarting Lumora

**Symptom:** Lumora reports a lost runtime instead of reconnecting its previous
terminal.

**Likely cause:** Generic PTY processes cannot be reattached after the Lumora
application process exits.

**Resolution:** Open **View details** on the Home **Needs attention** card and
use the recovery action beside the lost runtime to resume the provider-owned
session or start it again. This limitation is tracked for future work.

### The terminal bottom is clipped or does not resize correctly

**Symptom:** Part of the terminal viewport is hidden, especially after changing
window size or sidebar state.

**Likely cause:** Terminal viewport sizing remains a known MVP issue on some
layouts.

**Resolution:** Resize the window once. Switching away from a terminal and back
no longer re-measures it: a terminal is measured only when its box has actually
changed, so switching between terminals stays free and shows no resize. Do not
terminate a running provider solely to refresh the view. If the problem is
reproducible, include the window size and sidebar state in the issue report.

### No dot appears when a session finishes

- Check **Settings → General → Session status**: each cue has its own switch.
- A session in front of a focused Lumora window is being watched, so it gets no
  dot, tip or chime of its own.
- A terminal started through a custom launch command gets no hooks. It is
  marked only if the agent rings the terminal bell or prints a desktop
  notification itself.
- A Codex terminal shows no spinner until you trust Lumora's hooks: type
  `/hooks` in it and approve the ones from Lumora. They stay trusted afterwards.
- Lumora leaves your own Codex `notify` alone when it cannot read it in
  `config.toml` for certain, rather than risk silencing it, so that session
  reports only through its hooks. Write it as a list of strings on the top
  level, for example `notify = ["python3", "notify.py"]`.
- Agents other than Claude Code and Codex are marked only when they print a bell
  or a notification. On Windows the terminal layer may not pass every
  notification sequence through.
- Remote sessions do not report yet.

### Codex Shift+Enter does not create a new line

**Symptom:** Pressing `Shift+Enter` in a Codex terminal does not insert a
multiline newline, even though it works in some native terminals.

**Likely cause:** Current Codex releases do not reliably decode multiline key
input when hosted by Lumora's embedded Windows terminal. Lumora's
bracketed-paste compatibility sequence does not resolve every case.

**Resolution:** Treat this as an unresolved known issue. For now, compose
multiline text in an editor and paste it into Codex. Do not assume the
`Shift+Enter` compatibility path is working merely because the key is accepted.

## Reviewing changes

### Changes says to install git

**Symptom:** The **Changes** panel reports **Install git to see what changed in
this workspace** and lists nothing.

**Likely cause:** Lumora takes its snapshots with git and could not find it. It
accepts only an absolute path to a real git program, so a shell alias, a
function, or a `git` found beside the workspace is not used.

**Resolution:** Install git and confirm that its directory is on the `PATH` of
the account Lumora runs under. Lumora looks again a minute after a failed
lookup, so a new session picks it up without restarting Lumora. A session that
started while git was missing keeps **This session** unavailable, because its
starting point was never recorded; **All uncommitted** works as soon as git is
found, since it compares against the last commit.

### Changes says tracking started after the agent began

**Symptom:** The panel shows **Tracking started after the agent began, so its
first edits may be missing.**

**Likely cause:** Lumora gives the first snapshot up to three seconds and starts
the agent whether or not it has finished. Reading a large workspace for the
first time, in particular a folder that is not a git repository, can take longer
than that, so the starting point was taken after the agent had begun.

**Resolution:** Nothing needs fixing, and later sessions in the same workspace
are quick: Lumora keeps its own index of that workspace, so a second snapshot
only has to look at what changed. If the first edits matter, use **All
uncommitted** in a git repository, which compares against the last commit rather
than against the session's starting point.

### Changes says this workspace is too large

**Symptom:** The panel reports **This workspace is too large to track changes
in.**

**Likely cause:** A git command ran past its time limit, two minutes for a
snapshot and 30 seconds for everything else. That normally means a very large
working tree, a workspace full of generated files, or a folder on a slow or
network drive.

**Resolution:** Keep generated directories out of the count. In a git repository
add them to `.gitignore`; in a plain folder Lumora already skips the usual
dependency and build directories, such as `node_modules` and `dist`. Prefer a
local drive over a network share. A session that failed this way keeps **This
session** unavailable, so start a new session once the workspace is smaller.

### A file opens in its folder, or asks before opening

**Symptom:** **Open** on a changed file shows it in the system file manager
instead of opening it, or asks **Open this file?** first.

**Likely cause:** Lumora sorts what **Open** may do into three. Documents and
source files open directly. Scripts people also read, such as `.py`, `.sh`,
`.ps1`, `.rb`, `.js`, and `.vbs`, ask first, because opening one hands it to
whatever the system set up for that type, which may run it. Programs,
installers, shortcuts, loadable extensions, and, on macOS and Linux, anything
carrying an execute bit are always shown in their folder. The name is judged
twice, on the path in the list and on the file a link really leads to, and the
stricter answer wins. Only the execute bit is read from the real file.

**Resolution:** For the question, choose **Open anyway** to go ahead or **Show
in folder** to look first; Escape closes it without doing either. For a file
that is always shown in its folder, open it yourself in an editor if you want to
read it. A path that leads outside the workspace is refused altogether and
reports **That didn't work. Try again.**, which is also what a file deleted
since the list was taken reports.

### Changes is using a lot of disk space

**Symptom:** The `workspace-changes` folder inside Lumora's application-data
folder keeps growing.

**Likely cause:** Every snapshot keeps the content it found, stored as git
objects in Lumora's own folder, so a workspace with many sessions or large files
builds up data. A workspace's store is removed only 14 days after its last
session ended.

**Resolution:** Close Lumora, then delete that folder, or one workspace's folder
inside it, if you need the space sooner. Nothing in your projects or their
repositories is affected. Lumora takes a new starting point the next time a
session runs in that workspace, and the batches already listed in **History**
can no longer be opened.

## Remote computers

### Lumora asks to verify the remote identity

**Symptom:** The remote window will not accept credentials and asks for host
verification.

**Likely cause:** The SSH host fingerprint has not been trusted yet, or it
changed since the previous connection.

**Resolution:** Return to the local Lumora window, observe the fingerprint, and
compare it through a trusted channel with the remote computer. Trust it only
when it matches. Never bypass a changed fingerprint.

### A password or passphrase cannot be remembered

**Symptom:** The profile's remember switch is disabled, or Lumora asks for the
credential again after a restart.

**Likely cause:** Operating-system secure storage is unavailable, the Linux
desktop secret service is locked or missing, the credential was encrypted by a
different operating-system user, or the profile authentication method changed.

**Resolution:** Unlock or configure the current user's platform credential
store, restart Lumora, and connect manually. On Linux, Lumora intentionally
rejects Electron's `basic_text` fallback. Re-enter the credential and enable
remembering only after secure storage reports available. Lumora cannot recover
an encrypted credential from another OS account; forgetting it is safe and
does not modify the remote computer.

### Automatic remote connection stops at the connection page

**Symptom:** Opening a remote Lumora window makes one connection attempt, then
shows the manual controls.

**Likely cause:** The remembered credential is missing or unavailable, the SSH
agent has no usable identity, authentication failed, or the host fingerprint
requires verification.

**Resolution:** Verify the host identity in local Lumora, then connect manually
with the current credential. Update the remember and automatic-connect switches
for that profile. Lumora deliberately does not retry automatically in a loop.

### The remote helper is missing or incompatible

**Symptom:** SSH authentication succeeds, but the remote state is
`helper-missing` or `helper-incompatible`.

**Likely cause:** The per-user helper is absent, its digest does not match, or
its protocol is incompatible with this Lumora build.

**Resolution:** Review the version and install location in the remote window,
then choose **Install Lumora helper** if the target is expected. Lumora verifies
the packaged and uploaded copies before activation. The action does not require
administrator access. If it continues to fail, confirm that the SSH account can
write to its own home or local application-data directory and that security
software is not removing the helper.

### Remote target is ready but has no sessions or terminals

**Symptom:** The remote helper reports ready, but Lumora does not show remote
providers, sessions, or terminal controls.

**Likely cause:** No supported provider is enabled and detected, its remote
catalog contains no sessions, or the helper/catalog scan failed.

**Resolution:** Open remote **Settings > Environment** and **Providers**, verify
the executable and enabled-provider selection, then refresh the catalog. Check
the remote provider's own session directory and permissions if it remains
empty. Remote provider discovery, catalogs, and SSH PTY execution are available
in the current experimental remote feature.

### A remote computer cannot be deleted

**Symptom:** Deleting a remote computer from the **Remote** page fails with
**Lumora could not delete this remote computer. Disconnect it and try again.**,
even though it is not connected.

**Likely cause:** Fixed in 0.5.14. Earlier versions could not delete a
remote computer that had ever been scanned, because the workspaces, sessions,
and terminal profiles Lumora stored for it were left in place.

**Resolution:** Update Lumora and delete the computer again. Deleting removes
only what Lumora stored locally about that computer; files on the remote
computer are not touched.

## Diagnostics and abnormal shutdown

### Lumora reports that the previous run ended unexpectedly

**Symptom:** **Settings > Diagnostics** shows an abnormal-shutdown notice after
Lumora starts.

**Likely cause:** The previous process ended before Lumora completed orderly
terminal, remote, transfer, and storage cleanup. A forced operating-system
shutdown, process crash, or manually terminated development process can all
leave this marker.

**Resolution:** Review the bounded recent events, reproduce the issue once if it
is safe, then select **Export diagnostics** and attach the resulting JSON file
to a private support report. The export excludes prompts, terminal output,
session content, credentials, environment values, exception text, and paths.
Do not attach provider session files unless you separately intend to share
their contents.

### The Diagnostics page cannot load or export

**Symptom:** The page reports that diagnostics are temporarily unavailable, or
the save action fails.

**Likely cause:** Lumora cannot read its bounded diagnostic journal or cannot
write to the selected destination.

**Resolution:** Select **Refresh diagnostics**. For export, choose a writable
user directory and try again. Do not delete application data as a first step;
the journal rotates automatically and cannot block normal provider use.

### Process details show only Lumora's own processes

**Symptom:** **Process details** in **Settings > Diagnostics** says Lumora
could not read the processes it started, and each agent says its processes
could not be read.

**Likely cause:** Lumora reads process details through its packaged helper,
which it starts on this computer only while the window is open. The helper
could not start or answer: security software may have blocked it, or in a
development build the generated helper bundle is missing or out of date.

**Resolution:** Close the window, wait half a minute, and open it again; after
a failure Lumora waits 30 seconds before starting the helper again. If it keeps
failing, allow Lumora's `lumora-helper` executable in your security software. In
a development build, run `npm run helper:ensure`. Lumora's own app processes and
the figures on the Diagnostics page stay available either way.

### Lumora is using the default diagnostic folder instead of my selection

**Symptom:** **Settings > Diagnostics** reports that Lumora is using its default
journal folder for the current run.

**Likely cause:** The selected drive or directory was unavailable or not
writable when Lumora started.

**Resolution:** Reconnect the drive or choose another journal folder, then
restart Lumora. The custom selection is retained so a temporary unavailable
drive does not silently erase the preference. Use **Restore default journal
folder** if you want to return permanently to Lumora's application-data folder.

## Development builds

### Development and packaged Lumora show different data

**Symptom:** Workspaces, settings, or sessions configured in `npm run dev` do not
appear in the installed application, or the reverse.

**Likely cause:** This is intentional. Development and packaged Lumora use
separate application-data directories.

**Resolution:** Configure development data separately when testing. The
isolation prevents development work from changing the installed application's
catalog, settings, runtime history, or window state.

### `npm run dev` reports that Electron is uninstalled

**Symptom:** `electron-vite` builds the bundles but cannot find the Electron
runtime when starting the application.

**Likely cause:** The Electron platform binary was not downloaded with the
dependency installation.

**Resolution:** Stop the command, run `npm install`, then run `npm run dev`
again. The `predev` step also checks the Electron runtime before startup.

## Report an unresolved problem

Search the repository's existing
[GitHub issues](https://github.com/HAYASAKA7/Lumora/issues) before opening a new
one. Include:

- Lumora version and whether it is packaged or a development build;
- operating system and architecture;
- provider name, version, and installation method;
- terminal profile and whether a custom provider command is used;
- exact steps to reproduce the problem;
- expected and actual behavior;
- relevant warning text and screenshots;
- whether the problem continues after refreshing or restarting Lumora.

Do not post API keys, authentication tokens, private prompts, transcript
contents, confidential paths, or other secrets.

## Maintaining this guide

Add new entries to the narrowest existing category. Use one user-visible symptom
per heading and preserve the **Symptom**, **Likely cause**, and **Resolution**
labels. Prefer safe diagnostic steps over destructive resets, and link to an
official provider guide when the resolution belongs to the provider rather than
Lumora.
