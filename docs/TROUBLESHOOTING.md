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

**Resolution:** Run the provider's version command in a normal terminal. Confirm
that it succeeds, then restart Lumora and select **Refresh**. If the executable
uses a nonstandard path or wrapper, configure the provider command under
**Settings > Launch**.

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

## Managed terminals

### Copy or paste does not behave as expected

**Symptom:** `Ctrl+C` interrupts instead of copying, or clipboard text is not
pasted into the terminal.

**Likely cause:** No terminal text is selected, or the platform-specific
clipboard shortcut was not used.

**Resolution:** On Windows and Linux, use `Ctrl+Shift+C` and `Ctrl+Shift+V` for
unambiguous copy and paste; `Ctrl+V` also pastes. With selected text, `Ctrl+C`
copies. On macOS, use `Command+C` and `Command+V`.

### The first Ctrl+C does not interrupt the provider

**Symptom:** Pressing `Ctrl+C` once with no selected text shows an interrupt
notice but does not stop the running operation.

**Likely cause:** Lumora guards against accidental interrupts.

**Resolution:** Press `Ctrl+C` a second time while the notice is visible to send
the interrupt. Any other terminal key clears the armed interrupt.

### A terminal tab closes by itself

**Symptom:** A terminal tab disappears after the agent stops.

**Likely cause:** This is expected behavior. Lumora automatically closes a tab
when its managed provider process exits and refreshes the catalog.

**Resolution:** Resume the saved session or start a new one if more work is
needed. Report the problem only if the provider process is still running.

### A runtime cannot be restored after restarting Lumora

**Symptom:** Lumora reports a lost runtime instead of reconnecting its previous
terminal.

**Likely cause:** Generic PTY processes cannot be reattached after the Lumora
application process exits.

**Resolution:** Use Lumora's recovery action to resume the provider-owned
session or start it again. This limitation is tracked for future work.

### The terminal bottom is clipped or does not resize correctly

**Symptom:** Part of the terminal viewport is hidden, especially after changing
window size or sidebar state.

**Likely cause:** Terminal viewport sizing remains a known MVP issue on some
layouts.

**Resolution:** Resize the window once or switch away from and back to the
terminal. Do not terminate a running provider solely to refresh the view. If the
problem is reproducible, include the window size and sidebar state in the issue
report.

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
