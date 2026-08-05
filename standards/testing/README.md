# Testing standard

Behavior changes and bug fixes must use red-green-refactor: add the smallest
test that fails for the correct reason, implement the minimum fix, and rerun the
focused suite. Tests added only after implementation do not establish a
regression.

## Test layers

- Node-project tests cover main, preload, shared contracts, repositories,
  migrations, platform logic, PTY ownership, and release scripts.
- Renderer-project tests use Testing Library and jsdom to exercise user-visible
  behavior, accessibility roles, focus, and state transitions.
- Style contract tests protect cross-cutting UI invariants that DOM behavior
  alone cannot prove.
- Benchmarks protect catalog, transfer, and terminal hot paths.
- Packaged verification records native behavior that unit tests cannot prove.

Tests must be deterministic and isolated. Use temporary directories and
in-memory databases, inject clocks/processes/filesystems where useful, and
clean up listeners, timers, files, and handles. Avoid arbitrary sleeps,
machine-specific paths, installed-provider assumptions, network dependencies,
and order-dependent shared state.

Cross-platform code must cover Windows, macOS, and Linux branches. Migration
tests must open representative older schemas. Lifecycle tests must cover
repeated close, late events, concurrent calls, undefined native exit values,
and already-destroyed Electron objects where relevant.

## Verification sequence

    npm test -- path/to/focused.test.ts
    npm run typecheck
    npm run verify

`npm run verify` is the completion gate: all tests, TypeScript checks, and a
production build must exit successfully. A flaky failure must be investigated,
not ignored; an isolated pass may diagnose timing but does not replace a fresh
full pass.

## Canonical references

- `vitest.config.ts`
- `src/renderer/src/test-setup.ts`
- `src/main/catalog/catalog-service.bench.ts`
- `scripts/release/verify-package.cjs`

## Review checklist

- Was the regression observed failing before the fix?
- Does the test assert behavior rather than implementation trivia?
- Are error, cancellation, concurrency, and cleanup paths covered?
- Does the full verification gate pass without warnings caused by the change?
