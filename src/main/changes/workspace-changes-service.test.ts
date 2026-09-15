import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChangedFile } from '../../shared/changes';
import { CatalogRepository } from '../storage/catalog-repository';
import { migrateCatalogDatabase } from '../storage/migrations';
import { ChangesRepository } from './changes-repository';
import { GitCommandError } from './git-runner';
import { WorkspaceChangesService, type SnapshotEngineLike } from './workspace-changes-service';

const workspaceId = 'a'.repeat(64);
const file = (path: string, extra: Partial<ChangedFile> = {}): ChangedFile =>
  ({ path, oldPath: null, status: 'modified', additions: 1, deletions: 0, binary: false, ...extra });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

let database: DatabaseSync;
let engine: { [K in keyof SnapshotEngineLike]: ReturnType<typeof vi.fn> };
let counts: unknown[];
let now: Date;
let service: WorkspaceChangesService;
let idCounter = 0;

function createService(overrides: Record<string, unknown> = {}) {
  return new WorkspaceChangesService({
    repository: new ChangesRepository(database),
    engine: engine as unknown as SnapshotEngineLike,
    lookupWorkspace: () => ({ canonicalPath: '/work', available: true }),
    gitAvailable: async () => true,
    onCount: (count) => counts.push(count),
    openPath: vi.fn(async () => ''),
    showItemInFolder: vi.fn(),
    clock: () => now,
    // Services in one test share a database, so their ids come from one counter.
    createId: () => `id${++idCounter}`,
    launchWaitMs: 3_000,
    snapshotCacheMs: 0,
    ...overrides
  });
}

beforeEach(() => {
  database = new DatabaseSync(':memory:');
  migrateCatalogDatabase(database);
  new CatalogRepository(database).registerWorkspace(
    { id: workspaceId, canonicalPath: '/work', identityKey: '/work', displayName: 'work', available: true },
    'manual', '2026-09-15T00:00:00.000Z'
  );
  now = new Date('2026-09-15T01:00:00.000Z');
  counts = [];
  engine = {
    snapshot: vi.fn(async () => ({ kind: 'repository', tree: 't-base', head: 'h1' })),
    changedFiles: vi.fn(async () => []),
    fileDiff: vi.fn(async () => ({ patch: '@@\n+x', truncated: false })),
    headTree: vi.fn(async () => 't-head'),
    composeReviewed: vi.fn(async () => 't-reviewed'),
    removeWorkspace: vi.fn(async () => undefined)
  };
  service = createService();
});
afterEach(() => {
  service.dispose();
  database.close();
  vi.useRealTimers();
});

describe('WorkspaceChangesService', () => {
  it('records the baseline before the agent starts when it is quick', async () => {
    await service.begin({ ownerKind: 'terminal', ownerId: 'r1', workspaceId, catalogSessionId: null });
    const summary = await service.summary({ kind: 'session', ownerId: 'r1', view: 'session' });
    expect(summary).toMatchObject({ state: 'ready', baselineLate: false, files: [] });
    expect(counts).toEqual([{ ownerId: 'r1', workspaceId, state: 'ready', changedFileCount: 0 }]);
  });

  it('lets the agent start after the wait and marks a slow baseline late', async () => {
    vi.useFakeTimers();
    const slow = deferred<{ kind: 'folder'; tree: string; head: null }>();
    engine.snapshot.mockReturnValueOnce(slow.promise);
    const begun = service.begin({ ownerKind: 'unified', ownerId: 'c1', workspaceId, catalogSessionId: null });
    await vi.advanceTimersByTimeAsync(3_000);
    await begun;
    expect((await service.summary({ kind: 'session', ownerId: 'c1', view: 'session' })).state).toBe('capturing');
    slow.resolve({ kind: 'folder', tree: 't-base', head: null });
    await vi.advanceTimersByTimeAsync(0);
    engine.snapshot.mockResolvedValue({ kind: 'folder', tree: 't-now', head: null });
    expect(await service.summary({ kind: 'session', ownerId: 'c1', view: 'session' })).toMatchObject({ state: 'ready', baselineLate: true });
  });

  it('leaves no wait timer behind when the baseline is quick', async () => {
    vi.useFakeTimers();
    await service.begin({ ownerKind: 'terminal', ownerId: 'r1', workspaceId, catalogSessionId: null });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('says why changes cannot be tracked', async () => {
    const noGit = createService({ gitAvailable: async () => false });
    await noGit.begin({ ownerKind: 'terminal', ownerId: 'r1', workspaceId, catalogSessionId: null });
    expect((await noGit.summary({ kind: 'session', ownerId: 'r1', view: 'session' })).unavailableReason).toBe('git-missing');
    noGit.dispose();

    engine.snapshot.mockRejectedValueOnce(new GitCommandError('timeout'));
    await service.begin({ ownerKind: 'terminal', ownerId: 'r2', workspaceId, catalogSessionId: null });
    expect((await service.summary({ kind: 'session', ownerId: 'r2', view: 'session' })).unavailableReason).toBe('too-large');

    const missing = createService({ lookupWorkspace: () => null });
    await missing.begin({ ownerKind: 'terminal', ownerId: 'r3', workspaceId, catalogSessionId: null });
    expect(await missing.summary({ kind: 'session', ownerId: 'r3', view: 'session' }))
      .toMatchObject({ state: 'unavailable', unavailableReason: 'workspace-unavailable', files: [], checkedAt: null });
    missing.dispose();
  });

  it('never throws from begin, even for an unknown workspace or a repeated owner', async () => {
    await expect(service.begin({ ownerKind: 'terminal', ownerId: 'r1', workspaceId: 'b'.repeat(64), catalogSessionId: null })).resolves.toBeUndefined();
    await service.begin({ ownerKind: 'terminal', ownerId: 'r2', workspaceId, catalogSessionId: null });
    await expect(service.begin({ ownerKind: 'terminal', ownerId: 'r2', workspaceId, catalogSessionId: null })).resolves.toBeUndefined();
    await expect(service.summary({ kind: 'session', ownerId: 'unknown', view: 'session' })).rejects.toThrow();
  });

  it('separates files that now match a new commit, and reports sharing and counts', async () => {
    await service.begin({ ownerKind: 'terminal', ownerId: 'r1', workspaceId, catalogSessionId: null });
    await service.begin({ ownerKind: 'unified', ownerId: 'c1', workspaceId, catalogSessionId: null });
    engine.snapshot.mockResolvedValue({ kind: 'repository', tree: 't-now', head: 'h2' });
    engine.changedFiles.mockImplementation(async (_w: string, _p: string, from: string) =>
      from === 't-head' ? [file('b.txt')] : [file('a.txt'), file('b.txt')]);
    const summary = await service.summary({ kind: 'session', ownerId: 'r1', view: 'session' });
    expect(summary.files.map(({ path }) => path)).toEqual(['b.txt']);
    expect(summary.committed.map(({ path }) => path)).toEqual(['a.txt']);
    expect(summary.sharedWorkspace).toBe(true);
    expect(summary.checkedAt).toBe(now.toISOString());
    await service.refresh('r1');
    expect(counts.at(-1)).toEqual({ ownerId: 'r1', workspaceId, state: 'ready', changedFileCount: 1 });
    expect(service.counts()).toContainEqual({ ownerId: 'r1', workspaceId, state: 'ready', changedFileCount: 1 });
  });

  it('coalesces concurrent refreshes for one session', async () => {
    await service.begin({ ownerKind: 'terminal', ownerId: 'r1', workspaceId, catalogSessionId: null });
    engine.snapshot.mockClear();
    await Promise.all([service.refresh('r1'), service.refresh('r1'), service.refresh('r1')]);
    expect(engine.snapshot.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('caps long file lists and marks them truncated', async () => {
    await service.begin({ ownerKind: 'terminal', ownerId: 'r1', workspaceId, catalogSessionId: null });
    engine.changedFiles.mockResolvedValue(Array.from({ length: 5_001 }, (_, index) => file(`f${index}.txt`)));
    const summary = await service.summary({ kind: 'session', ownerId: 'r1', view: 'session' });
    expect(summary.files).toHaveLength(5_000);
    expect(summary.truncated).toBe(true);
  });

  it('shows uncommitted changes against HEAD, and says a folder is not a repository', async () => {
    await service.begin({ ownerKind: 'terminal', ownerId: 'r1', workspaceId, catalogSessionId: null });
    engine.snapshot.mockResolvedValue({ kind: 'repository', tree: 't-now', head: 'h1' });
    engine.changedFiles.mockResolvedValue([file('a.txt')]);
    const uncommitted = await service.summary({ kind: 'session', ownerId: 'r1', view: 'uncommitted' });
    expect(uncommitted.files.map(({ path }) => path)).toEqual(['a.txt']);
    expect(engine.changedFiles).toHaveBeenLastCalledWith(workspaceId, '/work', 't-head', 't-now');

    engine.snapshot.mockResolvedValue({ kind: 'folder', tree: 't-now', head: null });
    engine.headTree.mockResolvedValue(null);
    expect(await service.summary({ kind: 'session', ownerId: 'r1', view: 'uncommitted' }))
      .toMatchObject({ state: 'unavailable', unavailableReason: 'not-a-repository' });
  });

  it('shows a workspace\'s uncommitted changes, or why it cannot', async () => {
    engine.snapshot.mockResolvedValue({ kind: 'repository', tree: 't-now', head: 'h1' });
    engine.changedFiles.mockResolvedValue([file('a.txt')]);
    expect(await service.summary({ kind: 'workspace', workspaceId })).toMatchObject({
      state: 'ready', baselineLate: false, sharedWorkspace: false, files: [file('a.txt')]
    });

    const noGit = createService({ gitAvailable: async () => false });
    expect(await noGit.summary({ kind: 'workspace', workspaceId }))
      .toMatchObject({ state: 'unavailable', unavailableReason: 'git-missing' });
    noGit.dispose();
  });

  it('lists what a review covered from its own trees', async () => {
    await service.begin({ ownerKind: 'terminal', ownerId: 'r1', workspaceId, catalogSessionId: null });
    engine.snapshot.mockResolvedValue({ kind: 'repository', tree: 't-now', head: 'h1' });
    engine.changedFiles.mockResolvedValue([file('a.txt')]);
    await service.markReviewed('r1', null);
    const reviewId = service.history(workspaceId).segments[0]!.reviews[0]!.reviewId;
    engine.snapshot.mockClear();
    engine.changedFiles.mockClear();
    const summary = await service.summary({ kind: 'review', reviewId });
    expect(summary).toMatchObject({ state: 'ready', files: [file('a.txt')] });
    expect(engine.changedFiles).toHaveBeenCalledWith(workspaceId, '/work', 't-base', 't-now');
    expect(engine.snapshot).not.toHaveBeenCalled();
    await expect(service.summary({ kind: 'review', reviewId: 'missing' })).rejects.toThrow();
  });

  it('marks everything reviewed by moving the baseline, and some files by composing a tree', async () => {
    await service.begin({ ownerKind: 'terminal', ownerId: 'r1', workspaceId, catalogSessionId: null });
    engine.snapshot.mockResolvedValue({ kind: 'repository', tree: 't-now', head: 'h1' });
    engine.changedFiles.mockResolvedValue([file('a.txt'), file('new.txt', { status: 'renamed', oldPath: 'old.txt' })]);
    await service.markReviewed('r1', ['new.txt']);
    expect(engine.composeReviewed).toHaveBeenCalledWith(workspaceId, '/work', 't-base', 't-now', ['new.txt', 'old.txt']);
    await service.markReviewed('r1', null);
    const history = service.history(workspaceId);
    expect(history.segments[0]!.reviews.map(({ fileCount }) => fileCount)).toEqual([2, 1]);
  });

  it('records nothing when no chosen file has changed', async () => {
    await service.begin({ ownerKind: 'terminal', ownerId: 'r1', workspaceId, catalogSessionId: null });
    engine.changedFiles.mockResolvedValue([file('a.txt')]);
    await service.markReviewed('r1', ['other.txt']);
    expect(engine.composeReviewed).not.toHaveBeenCalled();
    expect(service.history(workspaceId).segments[0]!.reviews).toEqual([]);
  });

  it('passes a rename\'s old path when loading its diff, and reports binary files without a patch', async () => {
    await service.begin({ ownerKind: 'terminal', ownerId: 'r1', workspaceId, catalogSessionId: null });
    engine.snapshot.mockResolvedValue({ kind: 'repository', tree: 't-now', head: 'h1' });
    engine.changedFiles.mockResolvedValue([file('new.txt', { status: 'renamed', oldPath: 'old.txt' }), file('b.bin', { binary: true, additions: null, deletions: null })]);
    const source = { kind: 'session', ownerId: 'r1', view: 'session' } as const;
    await service.fileDiff(source, 'new.txt');
    expect(engine.fileDiff).toHaveBeenCalledWith(workspaceId, '/work', 't-base', 't-now', 'new.txt', 'old.txt');
    expect(await service.fileDiff(source, 'b.bin')).toEqual({ path: 'b.bin', patch: '', binary: true, truncated: false });
  });

  it('refuses a diff while the baseline is still missing', async () => {
    const noGit = createService({ gitAvailable: async () => false });
    await noGit.begin({ ownerKind: 'terminal', ownerId: 'r1', workspaceId, catalogSessionId: null });
    await expect(noGit.fileDiff({ kind: 'session', ownerId: 'r1', view: 'session' }, 'a.txt')).rejects.toThrow();
    noGit.dispose();
  });

  it('opens only paths inside the workspace', async () => {
    const openPath = vi.fn(async () => '');
    const scoped = createService({ openPath, lookupWorkspace: () => ({ canonicalPath: process.cwd(), available: true }) });
    await scoped.begin({ ownerKind: 'terminal', ownerId: 'r1', workspaceId, catalogSessionId: null });
    await expect(scoped.open({ kind: 'session', ownerId: 'r1', view: 'session' }, '../escape.txt', 'open')).rejects.toThrow();
    await scoped.open({ kind: 'session', ownerId: 'r1', view: 'session' }, 'package.json', 'open');
    expect(openPath).toHaveBeenCalledTimes(1);
    scoped.dispose();
  });

  it('reveals a file in its folder, and reports a file the system could not open', async () => {
    const showItemInFolder = vi.fn();
    const failing = createService({ showItemInFolder, openPath: async () => 'No application', lookupWorkspace: () => ({ canonicalPath: process.cwd(), available: true }) });
    await failing.open({ kind: 'workspace', workspaceId }, 'package.json', 'reveal');
    expect(showItemInFolder).toHaveBeenCalledTimes(1);
    await expect(failing.open({ kind: 'workspace', workspaceId }, 'package.json', 'open')).rejects.toThrow();
    failing.dispose();
  });

  it('refreshes only live terminal sessions on the timer', async () => {
    vi.useFakeTimers();
    await service.begin({ ownerKind: 'terminal', ownerId: 'r1', workspaceId, catalogSessionId: null });
    await service.begin({ ownerKind: 'unified', ownerId: 'c1', workspaceId, catalogSessionId: null });
    counts = [];
    service.startTerminalTimer();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(counts.map((count) => (count as { ownerId: string }).ownerId)).toEqual(['r1']);
    service.dispose();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(counts).toHaveLength(1);
  });

  it('refreshes a session once more when it ends', async () => {
    await service.begin({ ownerKind: 'terminal', ownerId: 'r1', workspaceId, catalogSessionId: null });
    counts = [];
    engine.changedFiles.mockResolvedValue([file('a.txt')]);
    service.end('r1');
    await vi.waitFor(() => expect(counts).toHaveLength(1));
    expect(service.counts()).toEqual([]);
    service.linkCatalogSession('r1', 'cat-1');
    expect(service.history(workspaceId).segments[0]).toMatchObject({ catalogSessionId: 'cat-1', endedAt: now.toISOString() });
  });

  it('ends open segments and prunes old ones at startup, removing stores left empty', async () => {
    await service.begin({ ownerKind: 'terminal', ownerId: 'r1', workspaceId, catalogSessionId: null });
    await service.startup();                                  // ends r1 at 2026-09-15
    now = new Date('2026-10-15T00:00:00.000Z');
    await service.startup();                                  // 30 days later: pruned
    expect(engine.removeWorkspace).toHaveBeenCalledWith(workspaceId);
    expect(service.history(workspaceId).segments).toEqual([]);
  });
});
