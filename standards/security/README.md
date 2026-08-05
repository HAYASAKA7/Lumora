# Security standard

Lumora treats renderer content, provider files, archives, terminal output,
workspace content, remote hosts, command output, and user-entered paths as
untrusted.

## Electron boundary

Every BrowserWindow must use sandboxing, context isolation, disabled Node
integration, web security, and the approved preload. New windows are denied and
navigation is restricted to the packaged `app://lumora` origin or the exact
development origin. External URLs must pass protocol validation and open
through a narrow main-process operation.

IPC must follow the [API standard](../api/README.md): authorize the sender,
enforce window target scope, parse requests before effects, and return validated
responses. Renderer input never grants authority.

## Files, commands, and secrets

- Canonicalize paths and prove containment before reading, writing, moving, or
  extracting.
- Bound file counts, individual sizes, total sizes, decompressed sizes,
  execution time, and retained memory.
- Build process arguments as arrays. Do not concatenate untrusted shell text.
- Workspace trust is required before launching an agent in that exact
  canonical workspace.
- Passwords and passphrases are ephemeral and must not be stored or logged.
- Provider tokens, environment variables, transcripts, raw terminal output,
  private paths, and archive contents must not enter routine logs or telemetry.

Remote SSH connections must verify a host fingerprint before trust is stored.
Changed fingerprints require a new explicit decision. Remote contexts must not
inherit local provider settings or access another target.

Transfers must authenticate archive structure and content, default to
encryption, use private staging, expire operation tokens, verify native imports,
and roll back when supported. Historical handoff content must be marked as
untrusted context.

## Canonical references

- `src/main/security-policy.ts`
- `src/main/ipc/ipc-access.ts`
- `src/main/transfer/transfer-path-safety.ts`
- `src/main/storage/remote-host-trust.test.ts`
- `src/main/remote/ssh-client.ts`

## Review checklist

- What inputs and identities are untrusted?
- Is authority rechecked immediately before mutation or launch?
- Are paths canonical, bounded, and contained?
- Can logs or renderer responses expose sensitive data?
- Is failure safe and cleanup guaranteed?
