# Provider integration standard

`src/shared/provider-definitions.ts` is the source of truth for provider
identity, display name, command, version arguments, installation method, and
support level. UI lists, scans, settings, and launch behavior must derive from
it rather than maintaining parallel provider lists.

## Capability levels

Support claims must distinguish:

- launch support;
- provider discovery and version probing;
- native session discovery;
- exact resume;
- native fork;
- token usage;
- cross-agent handoff;
- cross-device export/import.

A provider must not be presented as fully supported because its CLI launches.
Capabilities require adapter implementation, fixtures, failure isolation,
documentation, and native verification where applicable.

## Discovery and sessions

Provider discovery must use cross-platform executable resolution and bounded
version probes. One failing provider must not hide healthy results.

Session sources must be read-only, incremental where possible, bounded, and
tolerant of malformed records. Normalize metadata without rewriting provider
files or inventing a conflicting Lumora session identity. Preserve the last
healthy catalog snapshot when a scan partially fails.

Launch commands must use structured executable/argument arrays and the
provider's documented native resume/fork mechanism. Do not parse terminal text
to infer commands or session names. Empty optional prompts must send no prompt
argument.

Transfer routes remain experimental until the exact provider version and
source/destination platform combination has packaged verification evidence.

## Canonical references

- `src/shared/provider-definitions.ts`
- `src/main/providers/provider-registry.ts`
- `src/main/providers/session-catalog-adapter.ts`
- `src/main/providers/launch-command.ts`
- `src/main/transfer/transfer-adapter.ts`
- `docs/PROVIDER_SUPPORT.md`

## Review checklist

- Is there one provider definition and one truthful capability declaration?
- Are scan and parse costs bounded and failure-isolated?
- Are native identities and files preserved?
- Are launch arguments documented and tested on intended platforms?
- Does the support matrix match verified behavior?
