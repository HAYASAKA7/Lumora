# API and IPC standard

Lumora's preload bridge is an internal security API, not a convenience wrapper.
Every operation must have a complete path through shared contracts, preload,
authorized main-process IPC, a service, and tests.

## Contract rules

- Define channel names, request schemas, response schemas, events, and public
  TypeScript types in `src/shared/contracts.ts` or a focused shared module.
- Requests and responses must be serializable and validated with Zod on both
  sides of the boundary.
- The renderer must receive normalized data, opaque operation tokens, or safe
  status values—not filesystem paths, Electron objects, database handles,
  child processes, or provider credentials.
- Optional values must be modeled deliberately under
  `exactOptionalPropertyTypes`; do not use `undefined` accidentally.
- Event subscriptions must validate payloads and return an unsubscribe
  function.

## Handler rules

Every privileged handler must authorize its sender before doing work. Targeted
handlers must resolve or verify execution-target scope. Local-only mutations
must reject remote windows. Parse input before side effects and parse output
before returning it.

Expected failures must cross IPC as stable, non-sensitive product errors.
Unexpected exceptions may be logged in the main process, but renderer-facing
messages must not expose paths, commands, environment values, stack traces, or
secret material.

The preload must expose specific methods on `window.lumora`; never expose raw
`ipcRenderer`, arbitrary channel invocation, Node.js modules, or generic
filesystem/process methods.

## Canonical references

- `src/shared/contracts.ts`
- `src/preload/api.ts`
- `src/preload/index.ts`
- `src/main/ipc/ipc-access.ts`
- `src/main/ipc/register-target-ipc.ts`

## Review checklist

- Are request and response schemas applied on both sides?
- Is the sender authorized before parsing data into an operation?
- Is local/remote target scope explicit?
- Can the renderer gain any generic native capability?
- Are errors stable, actionable, and non-sensitive?
- Do API, preload, IPC, authorization, and subscription tests cover the route?
