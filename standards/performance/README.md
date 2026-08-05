# Performance standard

Lumora must remain responsive while scanning hundreds of sessions and while
multiple PTYs emit output. Optimization must preserve correctness, diagnostics,
and provider isolation.

## Main-process work

- Scan providers concurrently only within bounded resource limits.
- Cache or incrementally reuse unchanged provider sources.
- Coalesce duplicate refreshes and prevent stale results from replacing newer
  state.
- Bound files, rows, output tails, event chunks, command timeouts, and retained
  history.
- Keep expensive parsing, filesystem work, database writes, and process probes
  out of the renderer.

Terminal output must be coalesced into bounded sequenced events. Renderer
attachment receives a bounded tail rather than unbounded history. Late writes
after exit must terminate quietly without repeated IPC exceptions.

## Renderer work

Keep active terminal components mounted. Use progressive rendering for large
catalog lists, stable keys, memoized derived collections where measurement
shows value, and explicit loading states instead of rendering misleading zero
counts during startup scans.

Do not rebuild the tray menu, rerender every catalog card, or rescan providers
for high-frequency PTY output. Animation and overlays must not block startup
work or alter layout continuously.

## Evidence

Performance changes require a representative regression test or benchmark and
must document the workload measured. Do not optimize solely from intuition.
Compare results on the same machine and Node version, and verify that output,
catalog, and transfer behavior remain identical.

## Canonical references

- `src/main/providers/provider-scan-coordinator.ts`
- `src/main/terminal/output-buffer.ts`
- `src/renderer/src/catalog/progressive-list.tsx`
- `src/renderer/src/catalog/useCatalogAutoRefresh.ts`
- `src/main/catalog/catalog-service.bench.ts`
- `src/main/transfer/session-transfer-service.bench.ts`

## Review checklist

- Is work bounded in time, memory, concurrency, and output size?
- Can a stale or duplicate task overwrite newer truth?
- Does the change reduce user-visible frame loss under realistic load?
- Is there repeatable measurement without reduced test quality?
