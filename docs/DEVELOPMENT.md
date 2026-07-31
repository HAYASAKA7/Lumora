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
| `npm run benchmark:catalog` | Benchmark catalog refresh planning |
| `npm run benchmark:transfer` | Benchmark transfer planning and streamed archive memory |
| `npm run benchmark:terminal` | Compare batched and per-fragment terminal output processing |
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

Local Vitest runs use at most six workers so the desktop remains responsive
while all test files still execute. CI leaves worker selection to Vitest and
the runner. To override the local cap for a diagnostic run:

```powershell
npm test -- --maxWorkers=2
```

Tests that spawn Vite or esbuild child processes may require an unrestricted
local shell in tightly sandboxed development environments.

## Performance checks

Run the synthetic catalog benchmark when changing provider discovery, session
normalization, workspace canonicalization, or catalog persistence:

```powershell
npm run benchmark:catalog
```

The benchmark models 150 sessions across 30 workspaces. Its elapsed timings are
local comparison signals, not CI thresholds. Normal regression tests enforce
stable operation counts so differences in CI hardware do not cause flaky tests.

Run the terminal benchmark when changing PTY output buffering, runtime events,
or attachment snapshots:

```powershell
npm run benchmark:terminal
```

It compares equivalent schema-validated processing for a fragmented one-mebibyte
resume burst. Treat the result as a local comparison signal; provider-owned
transcript loading is outside this benchmark.

Run the transfer benchmark when changing archive, workspace mapping, provider
adapter, or transfer service code:

```powershell
npm run benchmark:transfer
```

It plans 1,000 sessions across 100 workspaces and 12 providers, then streams a
generated 512 MiB provider payload through the real archive writer without
retaining the payload in memory. The benchmark enforces a broad memory-growth
bound and reports elapsed time for local comparison; it is not a provider or
packaged route verification.

### Exercise an unverified transfer adapter

`npm run dev` exposes implemented adapter-backed transfer routes as
**Experimental**. This is the bootstrap path for testing export and import
before packaged evidence exists. Providers without an implemented transfer
adapter remain **Not verified**.

Development testing is diagnostic only. It does not add a record to the
verified route table and cannot make the route available in a normal packaged
release. Complete the native packaged matrix in
[Releasing Lumora](RELEASING.md#enable-a-verified-transfer-route) before release.

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
Record real CLI and operating-system smoke tests in the
[provider support matrix](PROVIDER_SUPPORT.md); automated adapter coverage is
not a substitute for those checks.

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
3. terminal input, output, resize, keyboard and right-click paste, selected-text
   copy, confirmed double-`Ctrl+C` stop, and Codex `/exit` fallback;
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
