# Remote computers

Remote computers are an experimental Lumora feature. The current phase creates
an isolated remote window, verifies SSH identity, detects the remote platform,
and installs and negotiates a lightweight Lumora helper. It does not yet expose
remote providers, saved sessions, workspaces, or terminals.

## Connect a computer

1. Open the separate **Remote** entrance in the lower sidebar.
2. Add a direct SSH profile or an SSH-config host.
3. Observe the SHA-256 host fingerprint and compare it with the remote computer
   through a trusted channel.
4. Trust the fingerprint only when it matches.
5. Open the isolated remote window and connect with the configured password,
   private key, or SSH agent method.

Passwords and passphrases are connection-only values. Lumora does not save or
log them.

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
- Reject an untrusted or changed host fingerprint.
- Connect each configured authentication method.
- Confirm that Cancel performs no installation.
- Install on a clean account and verify the state becomes `ready`.
- Corrupt a helper copy and verify Lumora requires confirmed replacement.
- Disconnect from missing, incompatible, and ready states.
- Test local/remote OS combinations independently where machines are available.
- Close Lumora and confirm the SSH channel and helper process stop cleanly.

See [Troubleshooting](TROUBLESHOOTING.md#remote-computers) when a target cannot
reach the ready state.
