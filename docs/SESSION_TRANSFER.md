# Move sessions between devices

Lumora's cross-device transfer workflow packages provider-owned sessions so
you can move them to another computer and continue with the same provider
account. It is a local file workflow: Lumora does not upload archives, convert
sessions into a Lumora-owned format, or synchronize them through a Lumora
service.

**Settings > Transfer** shows the capabilities available on the current
computer. Verified provider, version, and operating-system routes are marked
**Supported**. Implemented routes that have not completed the packaged matrix
are available as **Experimental** in both packaged and development builds. A
route marked **Not verified** remains unavailable.

Experimental access does not mark a route as verified. Keep the source archive
and provider data, and confirm imported sessions with the native provider before
relying on them.

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

Lumora checks the provider-native source identity or provenance before import
and again immediately before the provider write. Providers that preserve the
original identity are matched directly. Providers that create a new identity
during native import are matched using their native import/fork marker. If the
destination already has that session, Lumora skips it instead of overwriting or
renaming native data.

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

Implementation alone does not verify a route. The table records packaged
verification evidence; an implemented route with **Verification pending** is
shown as **Experimental**, while an unimplemented route remains unavailable.

| Provider | Export | Same-OS import | Cross-platform import |
| --- | --- | --- | --- |
| OpenCode | Verification pending | Verification pending | Verification pending |
| Codex | Verification pending | Verification pending | Verification pending |
| Claude Code | Verification pending | Verification pending | Verification pending |
| Gemini CLI | Verification pending | Verification pending | Verification pending |
| GitHub Copilot CLI | Verification pending | Verification pending | Verification pending |
| Qwen Code | Verification pending | Verification pending | Verification pending |
| Kimi Code | Verification pending | Verification pending | Verification pending |

All seven full-session providers have provider-specific transfer adapters:

- OpenCode uses its structured native export and import commands.
- Codex packages the native rollout, then uses prompt-free app-server fork,
  workspace mapping, and native title restoration to create a discoverable new
  thread with provider-owned provenance.
- Claude Code packages its native transcript and session companion directory
  while preserving the native session identity.
- Gemini CLI packages its native session file and uses Gemini's native import,
  which creates a new identity and records its imported source.
- GitHub Copilot CLI packages only the provider-owned session-state directory,
  preserves its UUID, and excludes global configuration and databases.
- Qwen Code packages its native project chat JSONL and preserves its identity.
- Kimi Code packages the complete selected native session directory, preserves
  its identity, maps it into the destination workspace bucket, and records the
  session in Kimi's append-only native index.

These implementations are available as **Experimental** routes in packaged and
development builds. They become **Supported** only after each exact provider
version and operating-system pair passes the transfer matrix.

See [Provider support and verification](PROVIDER_SUPPORT.md) for the release
matrix and [Troubleshooting Lumora](TROUBLESHOOTING.md#cross-device-session-transfer)
when an archive cannot be opened, mapped, or imported.
