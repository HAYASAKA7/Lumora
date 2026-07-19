# Developing Lumora

This guide covers source setup, project structure, verification, and local
development conventions. User-facing instructions live in the
[Lumora user guide](../README.md).

## Requirements

- Windows, macOS, or Linux
- Node.js 22 or newer
- npm
- Git
- At least one provider CLI when manually testing launch behavior

The repository's `.nvmrc` selects the version used by CI. With a compatible
Node version active, install the locked dependencies:

```powershell
npm ci
```

Use `npm install` when intentionally changing dependencies and updating
`package-lock.json`.

## Run the development application

```powershell
npm run dev
```

The `predev` step makes sure Electron's platform runtime exists before
`electron-vite` starts the main process, preload bundle, and renderer dev
server.

Development and packaged Lumora use separate application-data directories.
Unpackaged builds append `-dev` to Electron's normal `userData` path and use the
same directory for `sessionData`. Running `npm run dev` alongside an installed
Lumora package therefore does not share its catalog, settings, runtime history,
or window state.

## Commands

| Command | Purpose |
| --- | --- |
| `npm test` | Run all Vitest projects once |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run test:coverage` | Run tests with coverage enabled |
| `npm run typecheck` | Check main/preload and renderer TypeScript projects |
| `npm run verify` | Run tests, typechecking, and a production build |
| `npm run build` | Build main, preload, and renderer bundles into `out/` |
| `npm run package:dir` | Create an unpacked native application in `dist/` |
| `npm run package` | Build the native package configured for the host OS |

Run `npm run verify` before committing a code change.

## Project layout

```text
src/
  main/       Electron main process and privileged services
  preload/    typed, validated renderer API
  renderer/   React UI and xterm terminal views
  shared/     cross-process schemas, contracts, and provider definitions
resources/
  icons/      canonical Lumora platform icon assets
scripts/
  release/    package and release verification scripts
docs/         public architecture, development, and release documentation
.github/
  workflows/  CI, manual packaging, and tag-based prerelease workflows
```

Key ownership boundaries are described in
[Architecture](ARCHITECTURE.md#important-source-areas).

## Testing

Vitest has two projects:

- **node** tests cover `src/main`, `src/preload`, and `src/shared` in a Node.js
  environment;
- **renderer** tests cover React components in jsdom with Testing Library.

Run a focused file while iterating:

```powershell
npm test -- --run src/renderer/src/App.test.tsx
```

Run a named test:

```powershell
npm test -- --run src/renderer/src/App.test.tsx -t "opens a live terminal"
```

Tests that spawn Vite or esbuild child processes may require an unrestricted
local shell in tightly sandboxed development environments.

## Provider changes

`src/shared/provider-definitions.ts` is the canonical provider registry. A
provider definition contains its command, version arguments, session-support
level, npm package when allowlisted, and official installation guide.

Adding launch support and adding saved-session support are separate changes.
Saved-session support also requires a provider source adapter, fixtures,
normalization tests, discovery integration, exact-resume construction, and
catalog coverage. Do not mark a provider as complete until both discovery and
exact resume are reliable.

Provider source adapters must treat native session files as read-only inputs.
Invalid records should produce diagnostics without invalidating healthy data.

## IPC and security changes

Privileged behavior belongs in the main process. When adding an operation:

1. define strict request and response schemas in `src/shared/contracts.ts`;
2. expose the smallest necessary method through `src/preload/api.ts`;
3. validate the renderer sender and payload in a focused IPC handler;
4. keep filesystem, process, clipboard, and external-link access out of the
   renderer;
5. add contract, preload, IPC, and behavior tests proportional to the risk.

Do not enable Node integration or weaken renderer sandboxing to simplify a
feature.

## Database changes

Lumora uses Node.js SQLite and ordered migrations in
`src/main/storage/migrations.ts`. Schema changes must be additive migrations;
never edit an already-released migration in place. Cover forward migration,
idempotency, and repository behavior with tests.

## Manual terminal checks

Automated tests cannot fully represent native shells and interactive TUIs.
Before release, test at least:

1. new and resumed sessions;
2. custom provider commands and shell profiles;
3. terminal input, output, resize, copy, paste, and double-press interrupt;
4. terminal switching while navigating application pages;
5. automatic tab close and catalog refresh after process exit;
6. workspace trust grant and revocation;
7. restart behavior and lost-runtime reporting.

## Continuous integration

`.github/workflows/ci.yml` runs `npm ci` and `npm run verify` on Windows,
macOS, and Ubuntu for pushes and pull requests. Packaging and tagged releases
are separate workflows documented in [Releasing Lumora](RELEASING.md).

## Generated output

The following directories are local build artifacts and must not be committed:

- `node_modules/`
- `out/`
- `dist/`
- `coverage/`
- `.npm-cache/`
- `.worktrees/`
