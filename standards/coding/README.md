# Coding standard

## TypeScript

All code must pass the repository's strict TypeScript configuration, including
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and
`verbatimModuleSyntax`. Prefer narrow domain types, discriminated unions, Zod
inference, and immutable inputs over casts or broadly typed objects.

`any`, non-null assertions, ignored promises, and unchecked external data are
not acceptable shortcuts. A justified assertion must sit next to evidence that
makes it safe.

## Structure

- Keep one clear responsibility per module.
- Put code with the feature it serves; shared code must be genuinely shared.
- Inject filesystem, clock, process, database, and network dependencies where
  deterministic tests benefit.
- Prefer early guards and small named functions over deeply nested flows.
- Preserve existing public names unless a deliberate migration is included.
- Comments should explain constraints or reasons, not restate syntax.

Asynchronous work must have explicit ownership. Prevent stale responses from
overwriting newer state, remove listeners and timers, coalesce concurrent
operations when required, and make cleanup idempotent. Never access an Electron
window or web contents after it reports destruction.

Errors must use stable product codes at service or IPC boundaries. Do not
silently swallow failures that alter user-visible truth; expected late writes
to an already exited PTY may be suppressed only when runtime state proves the
target is gone.

## Change discipline

Use focused patches. Preserve unrelated user changes and avoid broad mechanical
rewrites during feature work. New behavior requires a failing regression test
before implementation. Run focused tests while iterating and `npm run verify`
before completion.

## Canonical references

- `tsconfig.json`
- `src/main/terminal/runtime-host.ts`
- `src/main/providers/provider-scan-coordinator.ts`
- `src/renderer/src/catalog/useCatalogAutoRefresh.ts`

## Review checklist

- Are types narrower than the data boundary they protect?
- Is lifecycle ownership explicit?
- Are resources, listeners, promises, and timers cleaned up?
- Is the module small enough to understand independently?
- Does the diff avoid unrelated churn and duplicated abstractions?
