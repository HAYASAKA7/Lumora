import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CatalogRepository } from '../storage/catalog-repository';
import { migrateCatalogDatabase } from '../storage/migrations';
import { ChangesRepository } from './changes-repository';
import { GitCommandError, type GitRunOptions } from './git-runner';
import { createLocalWorkspaceChanges, type LocalWorkspaceChanges } from './local-workspace-changes';

const workspaceId = 'a'.repeat(64);

let root: string;
let databasePath: string;
let opened: LocalWorkspaceChanges[];

function seed(apply: (database: DatabaseSync) => void): void {
  const database = new DatabaseSync(databasePath);
  try {
    migrateCatalogDatabase(database);
    apply(database);
  } finally {
    database.close();
  }
}

async function open(overrides: Partial<Parameters<typeof createLocalWorkspaceChanges>[0]> = {}) {
  const changes = await createLocalWorkspaceChanges({
    databasePath,
    storeRoot: join(root, 'store'),
    locateGit: async () => null,
    platform: 'linux',
    onCount: vi.fn(),
    openPath: async () => '',
    showItemInFolder: vi.fn(),
    ...overrides
  });
  opened.push(changes);
  return changes;
}

function segmentOf(ownerId: string) {
  const database = new DatabaseSync(databasePath);
  try {
    return new ChangesRepository(database).getSegmentByOwner(ownerId);
  } finally {
    database.close();
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lumora-local-changes-'));
  databasePath = join(root, 'lumora.db');
  mkdirSync(join(root, 'work'));
  opened = [];
  seed((database) => {
    new CatalogRepository(database).registerWorkspace(
      { id: workspaceId, canonicalPath: join(root, 'work'), identityKey: 'work', displayName: 'work', available: true },
      'manual',
      '2026-09-15T00:00:00.000Z'
    );
  });
});

afterEach(() => {
  for (const changes of opened) changes.close();
  rmSync(root, { recursive: true, force: true });
});

describe('createLocalWorkspaceChanges', () => {
  it('ends the segments the last run left open before any session starts', async () => {
    seed((database) => {
      new ChangesRepository(database).createSegment({
        id: 'segment-old', workspaceId, ownerKind: 'terminal', ownerId: 'runtime-old',
        catalogSessionId: null, createdAt: new Date().toISOString()
      });
    });

    const changes = await open();

    expect(changes.service.counts()).toEqual([]);
    expect(segmentOf('runtime-old')?.endedAt).not.toBeNull();
  });

  it('looks for git once and marks sessions untracked when it is missing', async () => {
    const locateGit = vi.fn(async () => null);
    const changes = await open({ locateGit });

    await changes.service.begin({ ownerKind: 'terminal', ownerId: 'runtime-1', workspaceId, catalogSessionId: null });
    await changes.service.begin({ ownerKind: 'unified', ownerId: 'connection-1', workspaceId, catalogSessionId: null });

    expect(locateGit).toHaveBeenCalledOnce();
    expect(segmentOf('runtime-1')).toMatchObject({ state: 'unavailable', unavailableReason: 'git-missing' });
    expect(segmentOf('connection-1')).toMatchObject({ state: 'unavailable', unavailableReason: 'git-missing' });
  });

  it('runs git from the path it found', async () => {
    const runGit = vi.fn(async (_options: GitRunOptions): Promise<never> => {
      throw new GitCommandError('failed');
    });
    const reportError = vi.fn();
    const changes = await open({ locateGit: async () => '/opt/git/bin/git', runGit, reportError });

    await changes.service.begin({ ownerKind: 'terminal', ownerId: 'runtime-1', workspaceId, catalogSessionId: null });

    expect(runGit).toHaveBeenCalled();
    expect(runGit.mock.calls.every(([options]) => options.gitPath === '/opt/git/bin/git'))
      .toBe(true);
    expect(reportError).toHaveBeenCalledWith('baseline', expect.any(GitCommandError));
  });

  it('never runs git by a bare name when git was not found', async () => {
    const runGit = vi.fn(async (_options: GitRunOptions): Promise<never> => {
      throw new Error('git must not run');
    });
    const reportError = vi.fn();
    const changes = await open({ runGit, reportError });
    seed((database) => {
      const repository = new ChangesRepository(database);
      repository.createSegment({
        id: 'segment-ready', workspaceId, ownerKind: 'terminal', ownerId: 'runtime-ready',
        catalogSessionId: null, createdAt: new Date().toISOString()
      });
      repository.recordBaseline('segment-ready', { snapshotKind: 'repository', tree: 'b'.repeat(40), head: null, late: false });
    });

    const summary = await changes.service.summary({ kind: 'session', ownerId: 'runtime-ready', view: 'session' });

    expect(summary).toMatchObject({ state: 'unavailable', unavailableReason: 'git-missing' });
    expect(runGit).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith('summary', expect.objectContaining({ reason: 'unavailable' }));
  });

  it('closes once', async () => {
    const changes = await open();

    changes.close();
    expect(() => changes.close()).not.toThrow();
  });
});
