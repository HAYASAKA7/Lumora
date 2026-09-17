import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CatalogRepository } from '../storage/catalog-repository';
import { migrateCatalogDatabase } from '../storage/migrations';
import { ChangesRepository } from './changes-repository';
import { runGit } from './git-runner';
import { WorkspaceSnapshotEngine } from './workspace-snapshot-engine';
import { WorkspaceChangesService } from './workspace-changes-service';

/**
 * The watched places running against real git, because the service's own tests
 * fake the engine: a place that snapshots the wrong folder looks identical to
 * one that works when the engine is a mock.
 */
const workspaceId = 'a'.repeat(64);

let root: string;
let database: DatabaseSync;
let service: WorkspaceChangesService;
let workspacePath: string;
let libraryPath: string;

const isolatedEnv = (): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith('GIT_'))),
  GIT_CONFIG_GLOBAL: join(root, 'test.gitconfig'),
  GIT_CONFIG_NOSYSTEM: '1'
});
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: isolatedEnv() });

function makeRepository(path: string, fileName: string): void {
  mkdirSync(path, { recursive: true });
  git(path, 'init', '-q', '.');
  git(path, 'config', 'user.email', 'test@example.invalid');
  git(path, 'config', 'user.name', 'Test');
  writeFileSync(join(path, fileName), 'one\n');
  git(path, 'add', '-A');
  git(path, 'commit', '-qm', 'init');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lumora-places-'));
  writeFileSync(join(root, 'test.gitconfig'), '[gc]\n\tauto = 0\n[maintenance]\n\tauto = false\n');
  workspacePath = join(root, 'work');
  libraryPath = join(root, 'lib');
  makeRepository(workspacePath, 'app.txt');
  makeRepository(libraryPath, 'index.txt');

  database = new DatabaseSync(':memory:');
  migrateCatalogDatabase(database);
  new CatalogRepository(database).registerWorkspace(
    {
      id: workspaceId,
      canonicalPath: workspacePath,
      identityKey: workspacePath,
      displayName: 'work',
      available: true
    },
    'manual',
    '2026-09-17T00:00:00.000Z'
  );

  let id = 0;
  service = new WorkspaceChangesService({
    repository: new ChangesRepository(database),
    engine: new WorkspaceSnapshotEngine({
      gitPath: 'git',
      storeRoot: join(root, 'store'),
      runGit
    }),
    lookupWorkspace: () => ({ canonicalPath: workspacePath, available: true }),
    gitAvailable: async () => true,
    onCount: () => undefined,
    openPath: vi.fn(async () => ''),
    showItemInFolder: vi.fn(),
    createId: () => `id${++id}`,
    snapshotCacheMs: 0
  });
});

afterEach(() => {
  service.dispose();
  database.close();
  rmSync(root, { recursive: true, force: true });
});

const sessionSource = { kind: 'session', ownerId: 'r1', view: 'session' } as const;

describe('watched places against real git', () => {
  it('lists what changed in a place watched before the session started', async () => {
    await service.addPlace(workspaceId, libraryPath);
    await service.begin({
      ownerKind: 'terminal', ownerId: 'r1', workspaceId, catalogSessionId: null
    });

    writeFileSync(join(workspacePath, 'app.txt'), 'two\n');
    writeFileSync(join(libraryPath, 'index.txt'), 'two\n');
    writeFileSync(join(libraryPath, 'added.txt'), 'new\n');

    const summary = await service.summary(sessionSource);

    expect(summary.places.map(({ name }) => name)).toEqual(['work', 'lib']);
    expect(summary.files.map(({ path }) => path).sort())
      .toEqual(['added.txt', 'app.txt', 'index.txt']);
    const library = summary.places[1]!;
    expect(summary.files.filter(({ placeId }) => placeId === library.id).map(({ path }) => path).sort())
      .toEqual(['added.txt', 'index.txt']);
  });

  it('lists a place that is a plain folder beside the workspace', async () => {
    const notes = join(root, 'notes');
    mkdirSync(notes, { recursive: true });
    writeFileSync(join(notes, 'todo.txt'), 'one\n');
    await service.addPlace(workspaceId, notes);
    await service.begin({
      ownerKind: 'terminal', ownerId: 'r1', workspaceId, catalogSessionId: null
    });

    writeFileSync(join(workspacePath, 'app.txt'), 'two\n');
    writeFileSync(join(notes, 'todo.txt'), 'two\n');

    const summary = await service.summary(sessionSource);

    expect(summary.files.map(({ path }) => path).sort()).toEqual(['app.txt', 'todo.txt']);
  });

  it('keeps two plain folders apart', async () => {
    const notes = join(root, 'notes');
    const drafts = join(root, 'drafts');
    for (const folder of [notes, drafts]) {
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, 'file.txt'), 'one\n');
    }
    await service.addPlace(workspaceId, notes);
    await service.addPlace(workspaceId, drafts);
    await service.begin({
      ownerKind: 'terminal', ownerId: 'r1', workspaceId, catalogSessionId: null
    });

    writeFileSync(join(drafts, 'file.txt'), 'two\n');

    const summary = await service.summary(sessionSource);

    const drafted = summary.places.find((place) => place.name === 'drafts');
    expect(summary.files.map(({ path, placeId }) => [path, placeId === drafted?.id]))
      .toEqual([['file.txt', true]]);
  });

  it('lists what changed in a place added while the session runs', async () => {
    await service.begin({
      ownerKind: 'terminal', ownerId: 'r1', workspaceId, catalogSessionId: null
    });
    await service.addPlace(workspaceId, libraryPath);

    writeFileSync(join(libraryPath, 'index.txt'), 'two\n');

    const summary = await service.summary(sessionSource);

    expect(summary.places[1]?.baselineLate).toBe(true);
    expect(summary.files.map(({ path }) => path)).toEqual(['index.txt']);
  });

  it('reads a diff and a full path from the place the file belongs to', async () => {
    await service.addPlace(workspaceId, libraryPath);
    await service.begin({
      ownerKind: 'terminal', ownerId: 'r1', workspaceId, catalogSessionId: null
    });
    writeFileSync(join(libraryPath, 'index.txt'), 'two\n');
    const summary = await service.summary(sessionSource);
    const placeId = summary.places[1]!.id;

    const diff = await service.fileDiff(sessionSource, placeId, 'index.txt');
    expect(diff.patch).toContain('+two');

    await expect(service.filePath(sessionSource, placeId, 'index.txt'))
      .resolves.toBe(join(libraryPath, 'index.txt'));
  });

  it('marks a file reviewed in its own place, leaving the workspace baseline alone', async () => {
    await service.addPlace(workspaceId, libraryPath);
    await service.begin({
      ownerKind: 'terminal', ownerId: 'r1', workspaceId, catalogSessionId: null
    });
    writeFileSync(join(workspacePath, 'app.txt'), 'two\n');
    writeFileSync(join(libraryPath, 'index.txt'), 'two\n');
    const before = await service.summary(sessionSource);
    const placeId = before.places[1]!.id;

    const after = await service.markReviewed('r1', [{ placeId, path: 'index.txt' }]);

    expect(after.files.map(({ path }) => path)).toEqual(['app.txt']);
  });
});
