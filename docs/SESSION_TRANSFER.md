# Move sessions between devices

Lumora's cross-device transfer workflow packages provider-owned sessions so
you can move them to another computer and continue with the same provider
account. It is a local file workflow: Lumora does not upload archives, convert
sessions into a Lumora-owned format, or synchronize them through a Lumora
service.

Transfer routes are enabled only after their provider, provider version, source
operating system, and destination operating system have passed packaged
verification. **Settings > Transfer** shows the capabilities available on the
current computer. A route marked **Not verified** cannot export or import.

## What an archive contains

A `.lumora-sessions` archive contains:

- the selected provider-native session payloads;
- provider and native session identities needed to detect duplicates;
- session titles;
- source workspace paths and portable workspace hints; and
- a small manifest describing the source operating system and archive entries.

An archive does not contain provider credentials, API keys, authentication
tokens, Lumora settings, terminal profiles, environment variables, workspace
files, or provider configuration. Lumora never transfers provider credentials.
Install and authenticate each provider separately on the destination device.

The archive keeps each provider's native session payload. Lumora does not merge
mixed providers into a normalized transcript and does not replace the source
session.

## Export stopped sessions

1. Let each session finish and close its managed terminal. Running sessions are
   disabled because their provider may still be writing data.
2. Open **Settings > Transfer** and select **Export sessions**.
3. Filter by provider if needed, then select individual sessions or all eligible
   sessions for a provider.
4. Select **Continue with _n_ sessions**.
5. Review the provider counts, excluded sessions, and estimated size.
6. Keep **Encrypt archive** enabled, enter and confirm a password, then choose
   where to save the archive.

Provider filtering does not clear the current selection. Selecting **Back** or
leaving the Transfer workflow clears selection. Lumora checks every selected
session again before writing the archive, so a session that started running,
became stale, or changed source is excluded safely.

Encryption is enabled by default and uses authenticated encryption. Lumora
cannot recover a forgotten archive password. If you turn encryption off,
anyone with the archive can read its provider session files; no password is
stored or sent for an unencrypted export.

## Import an archive

1. Copy the `.lumora-sessions` file to the destination computer using your
   preferred storage or transfer tool.
2. Install and authenticate the destination providers with the same provider
   accounts needed to resume those sessions.
3. In Lumora, enable those providers under **Settings > General**, then confirm
   they are detected under **Settings > Providers**.
4. Open **Settings > Transfer** and select **Import sessions**.
5. Choose the archive and enter its password when requested.
6. In a mixed-provider archive, select any installed, enabled, and verified
   providers you want to import. Unsupported providers stay unchanged inside
   the archive.
7. Map each source workspace to an existing destination directory.
8. Review the import plan and start the import.

Lumora imports only the providers you select. If one provider is missing,
disabled, outdated, or not verified for that operating-system route, install
or fix it and import that provider later from the same archive.

### Map workspaces between operating systems

Provider sessions refer to workspaces by path, and Windows, macOS, and Linux
use different path formats. Lumora groups sessions by their source workspace
and suggests a destination only when the evidence is strong enough. Suggestions
can use an existing canonical path and portable workspace hints; ambiguous
matches require your choice.

For every source workspace:

- choose an existing Lumora workspace whose directory already exists; or
- select **Add workspace**, choose an existing directory on disk, and then map
  the source workspace to it; or
- leave **Skip this workspace** selected.

Lumora does not create project directories or copy project files. Registering a
workspace only adds that existing directory to Lumora's catalog.

### Duplicate sessions are skipped

Lumora checks the provider-native session identity before import and again
immediately before the provider write. If the destination provider already has
that session, Lumora skips it instead of overwriting or renaming native data.

Imports are processed provider by provider. A failed provider item is rolled
back when the provider supports rollback, and a fatal provider failure prevents
later sessions for that provider from being changed. Other selected providers
can still complete. Lumora refreshes its catalog after verified imports.

## Retry skipped providers

The original archive is not consumed or modified. To retry:

1. install, enable, update, or authenticate the skipped provider;
2. add or correct its destination workspace;
3. confirm **Settings > Transfer** reports a supported route; and
4. open the same archive and select only that provider.

Already imported native session identities are recognized as duplicates and
skipped.

## Provider and operating-system support

Implementation alone does not enable a route. The table records packaged
verification evidence; **Verification pending** means the route remains
disabled in Lumora.

| Provider | Export | Same-OS import | Cross-platform import |
| --- | --- | --- | --- |
| OpenCode | Verification pending | Verification pending | Verification pending |
| Codex | Verification pending | Verification pending | Verification pending |
| Claude Code | Verification pending | Verification pending | Verification pending |
| Gemini CLI | Verification pending | Verification pending | Verification pending |
| GitHub Copilot CLI | Verification pending | Verification pending | Verification pending |
| Qwen Code | Verification pending | Verification pending | Verification pending |

OpenCode has the first transfer adapter because it exposes structured native
export and import commands. Its routes remain unavailable until each exact
provider-version and operating-system pair passes the packaged transfer matrix.
The other full-session providers require their own safe native adapter and
verification before they can be enabled.

See [Provider support and verification](PROVIDER_SUPPORT.md) for the release
matrix and [Troubleshooting Lumora](TROUBLESHOOTING.md#cross-device-session-transfer)
when an archive cannot be opened, mapped, or imported.
