# Architecture standard

## Required boundaries

Lumora must preserve this process split:

    React renderer -> validated preload API -> Electron main process
                                               |-- provider/platform services
                                               |-- SQLite repositories
                                               `-- node-pty runtimes

- The sandboxed renderer owns presentation and transient view state. It must
  not access Node.js, provider files, SQLite, Electron IPC, or process spawning.
- The preload owns the narrow `window.lumora` bridge. It must expose only
  product operations declared by shared contracts.
- The main process owns every privileged or native operation.
- `src/shared/` owns cross-process Zod schemas, serializable types, IPC channel
  names, provider definitions, and other platform-neutral contracts.

New features should be divided into small services with explicit dependencies.
Renderer components must call the preload API, IPC handlers must authorize and
validate, and handlers should delegate business logic to a service rather than
implementing it inline.

## Execution targets

All catalog, terminal, and remote operations must preserve execution-target
scope. A window receives one immutable `LumoraWindowContext`; the main process
resolves services through the target gateway. Local-only operations must reject
remote windows, and remote windows must not access another remote target.

Window lifecycle callbacks must not read Electron objects after destruction.
Capture stable IDs before registering `closed` handlers, make shutdown
idempotent, catch top-level asynchronous initialization, and close services in
dependency order.

## State ownership

- Provider-owned session files remain provider-owned and read-only except for
  explicit, verified import workflows.
- SQLite stores normalized metadata and Lumora settings, not transcript bodies.
- Active PTYs live in the main process; route changes must not recreate them.
- Renderer requests must not be treated as authority for paths, identities,
  capabilities, or trust.

## Canonical references

- `docs/ARCHITECTURE.md`
- `src/main/index.ts`
- `src/main/targets/execution-target-gateway.ts`
- `src/main/targets/window-context-registry.ts`
- `src/shared/contracts.ts`

## Review checklist

- Does each responsibility live in the correct process?
- Is target scope preserved at every boundary?
- Are services independently testable through injected dependencies?
- Can shutdown or repeated calls safely occur more than once?
- Did the change avoid introducing a second source of truth?
