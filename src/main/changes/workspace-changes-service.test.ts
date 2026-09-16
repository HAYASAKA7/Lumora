import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChangedFile } from '../../shared/changes';
import { CatalogRepository } from '../storage/catalog-repository';
import { migrateCatalogDatabase } from '../storage/migrations';
import { ChangesRepository } from './changes-repository';
import { GitCommandError } from './git-runner';
import {
  WorkspaceChangesService,
  type SnapshotEngineLike,
  type WorkspaceChangesServiceOptions
} from './workspace-changes-service';

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
let services: WorkspaceChangesService[];
let idCounter = 0;

function createService(overrides: Partial<WorkspaceChangesServiceOptions> = {}) {
  const created = new WorkspaceChangesService({
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
  services.push(created);
  return created;
}

const sessionSource = (ownerId: string, view: 'session' | 'uncommitted' = 'session') =>
  ({ kind: 'session', ownerId, view }) as const;
const begin = (target: WorkspaceChangesService, ownerId: string, ownerKind: 'terminal' | 'unified' = 'terminal') =>
  target.begin({ ownerKind, ownerId, workspaceId, catalogSessionId: null });

beforeEach(() => {
  database = new DatabaseSync(':memory:');
  migrateCatalogDatabase(database);
  new CatalogRepository(database).registerWorkspace(
    { id: workspaceId, canonicalPath: '/work', identityKey: '/work', displayName: 'work', available: true },
    'manual', '2026-09-15T00:00:00.000Z'
  );
  now = new Date('2026-09-15T01:00:00.000Z');
  counts = [];
  services = [];
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
  for (const created of services) created.dispose();
  database.close();
  vi.useRealTimers();
});

describe('WorkspaceChangesService', () => {
  it('records the baseline before the agent starts when it is quick', async () => {
    await begin(service, 'r1');
    const summary = await service.summary(sessionSource('r1'));
    expect(summary).toMatchObject({ state: 'ready', baselineLate: false, files: [] });
    expect(counts).toEqual([{ ownerId: 'r1', workspaceId, state: 'ready', changedFileCount: 0 }]);
  });

  it('lets the agent start after the wait and marks a slow baseline late', async () => {
    vi.useFakeTimers();
    const slow = deferred<{ kind: 'folder'; tree: string; head: null }>();
    engine.snapshot.mockReturnValueOnce(slow.promise);
    const begun = begin(service, 'c1', 'unified');
    await vi.advanceTimersByTimeAsync(3_000);
    await begun;
    expect((await service.summary(sessionSource('c1'))).state).toBe('capturing');
    slow.resolve({ kind: 'folder', tree: 't-base', head: null });
    await vi.advanceTimersByTimeAsync(0);
    engine.snapshot.mockResolvedValue({ kind: 'folder', tree: 't-now', head: null });
    expect(await service.summary(sessionSource('c1'))).toMatchObject({ state: 'ready', baselineLate: true });
  });

  it('counts a slow git lookup toward the launch wait', async () => {
    vi.useFakeTimers();
    const lookup = deferred<boolean>();
    const slow = createService({ gitAvailable: () => lookup.promise });
    let settled = false;
    const begun = begin(slow, 'c1', 'unified').then(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(2_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await begun;
    expect((await slow.summary(sessionSource('c1'))).state).toBe('capturing');

    lookup.resolve(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(await slow.summary(sessionSource('c1'))).toMatchObject({ state: 'ready', baselineLate: true });
  });

  it('marks git missing even when the lookup answers after the wait', async () => {
    vi.useFakeTimers();
    const lookup = deferred<boolean>();
    const slow = createService({ gitAvailable: () => lookup.promise });
    const begun = begin(slow, 'c1', 'unified');
    await vi.advanceTimersByTimeAsync(3_000);
    await begun;

    lookup.resolve(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(await slow.summary(sessionSource('c1'))).toMatchObject({ state: 'unavailable', unavailableReason: 'git-missing' });
    expect(engine.snapshot).not.toHaveBeenCalled();
  });

  it('does not count a late baseline for a session that already ended', async () => {
    vi.useFakeTimers();
    const slow = deferred<{ kind: 'folder'; tree: string; head: null }>();
    engine.snapshot.mockReturnValueOnce(slow.promise);
    const begun = begin(service, 'c1', 'unified');
    await vi.advanceTimersByTimeAsync(3_000);
    await begun;
    service.end('c1');
    await vi.advanceTimersByTimeAsync(0);
    counts = [];
    slow.resolve({ kind: 'folder', tree: 't-base', head: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(counts).toEqual([]);
  });

  it('leaves no wait timer behind when the baseline is quick', async () => {
    vi.useFakeTimers();
    await begin(service, 'r1');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('says why changes cannot be tracked', async () => {
    const noGit = createService({ gitAvailable: async () => false });
    await begin(noGit, 'r1');
    expect((await noGit.summary(sessionSource('r1'))).unavailableReason).toBe('git-missing');

    engine.snapshot.mockRejectedValueOnce(new GitCommandError('timeout'));
    await begin(service, 'r2');
    expect((await service.summary(sessionSource('r2'))).unavailableReason).toBe('too-large');

    // A slow diff says nothing about the workspace's size, unlike a slow snapshot.
    await begin(service, 'r4');
    engine.changedFiles.mockRejectedValueOnce(new GitCommandError('timeout'));
    expect((await service.summary(sessionSource('r4'))).unavailableReason).toBe('failed');

    const missing = createService({ lookupWorkspace: () => null });
    await begin(missing, 'r3');
    expect(await missing.summary(sessionSource('r3')))
      .toMatchObject({ state: 'unavailable', unavailableReason: 'workspace-unavailable', files: [], checkedAt: null });
  });

  it('never throws from begin, even for an unknown workspace or a repeated owner', async () => {
    await expect(service.begin({ ownerKind: 'terminal', ownerId: 'r1', workspaceId: 'b'.repeat(64), catalogSessionId: null })).resolves.toBeUndefined();
    await begin(service, 'r2');
    await expect(begin(service, 'r2')).resolves.toBeUndefined();
    const failingIds = createService({ createId: () => { throw new Error('no ids'); } });
    await expect(begin(failingIds, 'r3')).resolves.toBeUndefined();
    await expect(service.summary(sessionSource('unknown'))).rejects.toThrow();
  });

  it('reports failures it recovers from, and survives a failing reporter', async () => {
    const reported: string[] = [];
    const reporting = createService({ reportError: (operation) => { reported.push(operation); } });
    engine.snapshot.mockRejectedValueOnce(new GitCommandError('failed'));
    await begin(reporting, 'r1');
    expect(reported).toEqual(['baseline']);

    await begin(reporting, 'r2');
    engine.changedFiles.mockRejectedValueOnce(new Error('diff failed'));
    expect((await reporting.summary(sessionSource('r2'))).state).toBe('unavailable');
    expect(reported).toContain('summary');

    const throwing = createService({ reportError: () => { throw new Error('reporter broke'); } });
    engine.snapshot.mockRejectedValueOnce(new GitCommandError('failed'));
    await expect(begin(throwing, 'r3')).resolves.toBeUndefined();
  });

  it('separates files that now match a new commit, and reports sharing and counts', async () => {
    await begin(service, 'r1');
    await begin(service, 'c1', 'unified');
    engine.snapshot.mockResolvedValue({ kind: 'repository', tree: 't-now', head: 'h2' });
    engine.changedFiles.mockImplementation(async (_w: string, _p: string, from: string) =>
      from === 't-head' ? [file('b.txt')] : [file('a.txt'), file('b.txt')]);
    const summary = await service.summary(sessionSource('r1'));
    expect(summary.files.map(({ path }) => path)).toEqual(['b.txt']);
    expect(summary.committed.map(({ path }) => path)).toEqual(['a.txt']);
    expect(summary.sharedWorkspace).toBe(true);
    expect(summary.checkedAt).toBe(now.toISOString());
    await service.refresh('r1');
    expect(counts.at(-1)).toEqual({ ownerId: 'r1', workspaceId, state: 'ready', changedFileCount: 1 });
    expect(service.counts()).toContainEqual({ ownerId: 'r1', workspaceId, state: 'ready', changedFileCount: 1 });
  });

  it('keeps the last count when a refresh fails for a moment', async () => {
    await begin(service, 'r1');
    engine.changedFiles.mockResolvedValue([file('a.txt')]);
    await service.refresh('r1');
    counts = [];
    engine.snapshot.mockRejectedValueOnce(new GitCommandError('failed'));
    await service.refresh('r1');
    expect(counts).toEqual([]);
    expect(service.counts()).toEqual([{ ownerId: 'r1', workspaceId, state: 'ready', changedFileCount: 1 }]);
  });

  it('coalesces concurrent refreshes for one session into one more run', async () => {
    await begin(service, 'r1');
    const first = deferred<{ kind: 'repository'; tree: string; head: string }>();
    const second = deferred<{ kind: 'repository'; tree: string; head: string }>();
    engine.snapshot.mockClear();
    engine.snapshot.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    let settled = 0;
    const runs = [service.refresh('r1'), service.refresh('r1'), service.refresh('r1')]
      .map((run) => run.then(() => { settled += 1; }));
    await vi.waitFor(() => expect(engine.snapshot).toHaveBeenCalledTimes(1));
    first.resolve({ kind: 'repository', tree: 't-now', head: 'h1' });
    await vi.waitFor(() => expect(engine.snapshot).toHaveBeenCalledTimes(2));
    expect(settled).toBe(0);
    second.resolve({ kind: 'repository', tree: 't-now', head: 'h1' });
    await Promise.all(runs);
    expect(settled).toBe(3);
    expect(engine.snapshot).toHaveBeenCalledTimes(2);
  });

  it('caps long file lists and marks them truncated', async () => {
    await begin(service, 'r1');
    engine.changedFiles.mockResolvedValue(Array.from({ length: 5_001 }, (_, index) => file(`f${index}.txt`)));
    const summary = await service.summary(sessionSource('r1'));
    expect(summary.files).toHaveLength(5_000);
    expect(summary.truncated).toBe(true);
  });

  it('shows uncommitted changes against HEAD, and says a folder is not a repository', async () => {
    await begin(service, 'r1');
    engine.snapshot.mockResolvedValue({ kind: 'repository', tree: 't-now', head: 'h1' });
    engine.changedFiles.mockResolvedValue([file('a.txt')]);
    const uncommitted = await service.summary(sessionSource('r1', 'uncommitted'));
    expect(uncommitted.files.map(({ path }) => path)).toEqual(['a.txt']);
    expect(engine.changedFiles).toHaveBeenLastCalledWith(workspaceId, '/work', 't-head', 't-now');

    engine.snapshot.mockResolvedValue({ kind: 'folder', tree: 't-now', head: null });
    engine.headTree.mockResolvedValue(null);
    expect(await service.summary(sessionSource('r1', 'uncommitted')))
      .toMatchObject({ state: 'unavailable', unavailableReason: 'not-a-repository' });
  });

  it('shows uncommitted changes while the session baseline is still being captured', async () => {
    const quickWait = createService({ launchWaitMs: 0 });
    const slow = deferred<{ kind: 'repository'; tree: string; head: string }>();
    engine.snapshot.mockReturnValueOnce(slow.promise);
    await begin(quickWait, 'r1');
    engine.snapshot.mockResolvedValue({ kind: 'repository', tree: 't-now', head: 'h1' });
    engine.changedFiles.mockResolvedValue([file('a.txt')]);
    expect((await quickWait.summary(sessionSource('r1'))).state).toBe('capturing');
    expect(await quickWait.summary(sessionSource('r1', 'uncommitted')))
      .toMatchObject({ state: 'ready', files: [file('a.txt')] });
    slow.resolve({ kind: 'repository', tree: 't-base', head: 'h1' });
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
  });

  it('lists what a review covered from its own trees', async () => {
    await begin(service, 'r1');
    engine.snapshot.mockResolvedValue({ kind: 'repository', tree: 't-now', head: 'h1' });
    engine.changedFiles.mockResolvedValue([file('a.txt')]);
    engine.composeReviewed.mockResolvedValue('t-now');
    await service.markReviewed('r1', ['a.txt']);
    const reviewId = service.history(workspaceId).segments[0]!.reviews[0]!.reviewId;
    engine.snapshot.mockClear();
    engine.changedFiles.mockClear();
    const summary = await service.summary({ kind: 'review', reviewId });
    expect(summary).toMatchObject({ state: 'ready', files: [file('a.txt')] });
    expect(engine.changedFiles).toHaveBeenCalledWith(workspaceId, '/work', 't-base', 't-now');
    expect(engine.snapshot).not.toHaveBeenCalled();
    await expect(service.summary({ kind: 'review', reviewId: 'missing' })).rejects.toThrow();
  });

  it('marks the listed files reviewed by composing a tree that includes renamed old paths', async () => {
    await begin(service, 'r1');
    engine.snapshot.mockResolvedValue({ kind: 'repository', tree: 't-now', head: 'h1' });
    engine.changedFiles.mockResolvedValue([file('a.txt'), file('new.txt', { status: 'renamed', oldPath: 'old.txt' })]);
    await service.markReviewed('r1', ['new.txt']);
    expect(engine.composeReviewed).toHaveBeenCalledWith(workspaceId, '/work', 't-base', 't-now', ['new.txt', 'old.txt']);
    await service.markReviewed('r1', ['a.txt', 'new.txt']);
    expect(engine.composeReviewed).toHaveBeenLastCalledWith(workspaceId, '/work', 't-reviewed', 't-now', ['a.txt', 'new.txt', 'old.txt']);
    const history = service.history(workspaceId);
    expect(history.segments[0]!.reviews.map(({ fileCount }) => fileCount)).toEqual([2, 1]);
    await expect(service.markReviewed('r1', [])).rejects.toThrow();
  });

  it('queues overlapping reviews so each starts from the one before', async () => {
    await begin(service, 'r1');
    engine.snapshot.mockResolvedValue({ kind: 'repository', tree: 't-now', head: 'h1' });
    engine.changedFiles.mockResolvedValue([file('a.txt'), file('b.txt')]);
    const composed = deferred<string>();
    engine.composeReviewed.mockReturnValueOnce(composed.promise).mockResolvedValueOnce('t-r2');
    const firstReview = service.markReviewed('r1', ['a.txt']);
    const secondReview = service.markReviewed('r1', ['b.txt']);
    await vi.waitFor(() => expect(engine.composeReviewed).toHaveBeenCalledTimes(1));
    composed.resolve('t-r1');
    await Promise.all([firstReview, secondReview]);

    expect(engine.composeReviewed.mock.calls).toEqual([
      [workspaceId, '/work', 't-base', 't-now', ['a.txt']],
      [workspaceId, '/work', 't-r1', 't-now', ['b.txt']]
    ]);
    const repository = new ChangesRepository(database);
    const segment = repository.getSegmentByOwner('r1')!;
    expect(segment.baselineTree).toBe('t-r2');
    expect(repository.listReviews(segment.id).map(({ fromTree, toTree }) => [fromTree, toTree]))
      .toEqual([['t-r1', 't-r2'], ['t-base', 't-r1']]);
  });

  it('records nothing when no listed file has changed', async () => {
    await begin(service, 'r1');
    engine.changedFiles.mockResolvedValue([file('a.txt')]);
    await service.markReviewed('r1', ['other.txt']);
    expect(engine.composeReviewed).not.toHaveBeenCalled();
    expect(service.history(workspaceId).segments[0]!.reviews).toEqual([]);
  });

  it('passes a rename\'s old path when loading its diff, and reports binary files without a patch', async () => {
    await begin(service, 'r1');
    engine.snapshot.mockResolvedValue({ kind: 'repository', tree: 't-now', head: 'h1' });
    engine.changedFiles.mockResolvedValue([file('new.txt', { status: 'renamed', oldPath: 'old.txt' }), file('b.bin', { binary: true, additions: null, deletions: null })]);
    const source = sessionSource('r1');
    await service.fileDiff(source, 'new.txt');
    expect(engine.fileDiff).toHaveBeenCalledWith(workspaceId, '/work', 't-base', 't-now', 'new.txt', 'old.txt');
    expect(await service.fileDiff(source, 'b.bin')).toEqual({ path: 'b.bin', patch: '', binary: true, truncated: false });
  });

  it('lists the changed files once for a summary and the diffs opened right after it', async () => {
    const cached = createService({ snapshotCacheMs: 5_000 });
    await begin(cached, 'r1');
    engine.changedFiles.mockResolvedValue([file('a.txt'), file('b.txt')]);
    const source = sessionSource('r1');

    expect((await cached.summary(source)).files).toHaveLength(2);
    const listings = engine.changedFiles.mock.calls.length;
    await cached.fileDiff(source, 'a.txt');
    await cached.fileDiff(source, 'b.txt');

    expect(engine.changedFiles).toHaveBeenCalledTimes(listings);
    expect(engine.fileDiff).toHaveBeenCalledTimes(2);

    now = new Date(now.getTime() + 6_000);
    await cached.fileDiff(source, 'a.txt');
    expect(engine.changedFiles.mock.calls.length).toBeGreaterThan(listings);
  });

  it('refuses a diff while the baseline is still missing', async () => {
    const noGit = createService({ gitAvailable: async () => false });
    await begin(noGit, 'r1');
    await expect(noGit.fileDiff(sessionSource('r1'), 'a.txt')).rejects.toThrow();
  });

  describe('opening files', () => {
    let root: string;

    beforeEach(() => {
      // Opened paths are real paths, so compare against the real temporary folder.
      root = realpathSync(mkdtempSync(join(tmpdir(), 'lumora-changes-open-')));
      writeFileSync(join(root, 'notes.txt'), 'hello');
    });
    afterEach(() => rmSync(root, { recursive: true, force: true }));

    it('opens only paths inside the workspace', async () => {
      const openPath = vi.fn(async () => '');
      const scoped = createService({ openPath, lookupWorkspace: () => ({ canonicalPath: root, available: true }) });
      await begin(scoped, 'r1');
      await expect(scoped.open(sessionSource('r1'), '../escape.txt', 'open')).rejects.toThrow();
      await scoped.open(sessionSource('r1'), 'notes.txt', 'open');
      expect(openPath).toHaveBeenCalledTimes(1);
    });

    it('refuses a file reached through a link that leaves the workspace', async () => {
      const outside = mkdtempSync(join(tmpdir(), 'lumora-changes-outside-'));
      try {
        writeFileSync(join(outside, 'secret.txt'), 'secret');
        symlinkSync(outside, join(root, 'linked'), 'junction');
        const openPath = vi.fn(async () => '');
        const showItemInFolder = vi.fn();
        const scoped = createService({ openPath, showItemInFolder, lookupWorkspace: () => ({ canonicalPath: root, available: true }) });
        const source = { kind: 'workspace', workspaceId } as const;

        await expect(scoped.open(source, 'linked/secret.txt', 'open')).rejects.toThrow();
        await expect(scoped.open(source, 'linked/secret.txt', 'reveal')).rejects.toThrow();
        expect(openPath).not.toHaveBeenCalled();
        expect(showItemInFolder).not.toHaveBeenCalled();
      } finally {
        rmSync(join(root, 'linked'), { recursive: false, force: true });
        rmSync(outside, { recursive: true, force: true });
      }
    });

    it('reveals files that would run instead of opening them', async () => {
      writeFileSync(join(root, 'build.bat'), '@echo off');
      writeFileSync(join(root, 'Tool.lnk'), 'shortcut');
      writeFileSync(join(root, 'index.ts'), 'export {};');
      writeFileSync(join(root, 'tool.py'), 'print(1)');
      const openPath = vi.fn(async () => '');
      const showItemInFolder = vi.fn();
      const scoped = createService({ openPath, showItemInFolder, lookupWorkspace: () => ({ canonicalPath: root, available: true }) });
      const source = { kind: 'workspace', workspaceId } as const;

      await scoped.open(source, 'build.bat', 'open');
      await scoped.open(source, 'Tool.lnk', 'open');
      await scoped.open(source, 'tool.py', 'open');
      await scoped.open(source, 'index.ts', 'open');

      expect(showItemInFolder.mock.calls).toEqual([[join(root, 'build.bat')], [join(root, 'Tool.lnk')], [join(root, 'tool.py')]]);
      expect(openPath).toHaveBeenCalledExactlyOnceWith(join(root, 'index.ts'));
    });

    it('reveals a harmless-looking link to a file that would run', async (context) => {
      writeFileSync(join(root, 'build.bat'), '@echo off');
      try {
        symlinkSync(join(root, 'build.bat'), join(root, 'readme.txt'), 'file');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') {
          context.skip('Creating file symlinks needs privileges on this Windows account.');
        }
        throw error;
      }
      const openPath = vi.fn(async () => '');
      const showItemInFolder = vi.fn();
      const scoped = createService({ openPath, showItemInFolder, lookupWorkspace: () => ({ canonicalPath: root, available: true }) });

      await scoped.open({ kind: 'workspace', workspaceId }, 'readme.txt', 'open');

      expect(openPath).not.toHaveBeenCalled();
      expect(showItemInFolder).toHaveBeenCalledExactlyOnceWith(realpathSync(join(root, 'build.bat')));
    });

    it('reveals the file a directory link inside the workspace leads to', async () => {
      mkdirSync(join(root, 'sub'));
      writeFileSync(join(root, 'sub', 'build.bat'), '@echo off');
      // A junction needs no privileges on Windows, so this link case runs everywhere.
      symlinkSync(join(root, 'sub'), join(root, 'mirror'), 'junction');
      const openPath = vi.fn(async () => '');
      const showItemInFolder = vi.fn();
      const scoped = createService({ openPath, showItemInFolder, lookupWorkspace: () => ({ canonicalPath: root, available: true }) });

      await scoped.open({ kind: 'workspace', workspaceId }, 'mirror/build.bat', 'open');

      expect(openPath).not.toHaveBeenCalled();
      expect(showItemInFolder).toHaveBeenCalledExactlyOnceWith(realpathSync(join(root, 'sub', 'build.bat')));
    });

    it('cannot open a deleted file but reveals the folder it was in', async () => {
      const openPath = vi.fn(async () => '');
      const showItemInFolder = vi.fn();
      const scoped = createService({ openPath, showItemInFolder, lookupWorkspace: () => ({ canonicalPath: root, available: true }) });
      const source = { kind: 'workspace', workspaceId } as const;

      await expect(scoped.open(source, 'deleted.txt', 'open')).rejects.toThrow();
      await scoped.open(source, 'deleted.txt', 'reveal');

      expect(openPath).not.toHaveBeenCalled();
      expect(showItemInFolder).toHaveBeenCalledExactlyOnceWith(root);
    });

    it('reveals a file in its folder, and reports a file the system could not open', async () => {
      const showItemInFolder = vi.fn();
      const failing = createService({ showItemInFolder, openPath: async () => 'No application', lookupWorkspace: () => ({ canonicalPath: root, available: true }) });
      await failing.open({ kind: 'workspace', workspaceId }, 'notes.txt', 'reveal');
      expect(showItemInFolder).toHaveBeenCalledWith(join(root, 'notes.txt'));
      await expect(failing.open({ kind: 'workspace', workspaceId }, 'notes.txt', 'open')).rejects.toThrow();
    });
  });

  it('refreshes only live terminal sessions on the timer', async () => {
    vi.useFakeTimers();
    await begin(service, 'r1');
    await begin(service, 'c1', 'unified');
    counts = [];
    service.startTerminalTimer();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(counts.map((count) => (count as { ownerId: string }).ownerId)).toEqual(['r1']);
    service.dispose();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(counts).toHaveLength(1);
  });

  it('reports a timer tick that fails', async () => {
    vi.useFakeTimers();
    const repository = new ChangesRepository(database);
    vi.spyOn(repository, 'listOpenSegments').mockImplementation(() => { throw new Error('database busy'); });
    const reported: string[] = [];
    const ticking = createService({ repository, reportError: (operation) => { reported.push(operation); } });
    ticking.startTerminalTimer();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(reported).toEqual(['timer']);
  });

  describe('after dispose', () => {
    it('ignores late session calls without touching the repository or reporting', async () => {
      const repository = new ChangesRepository(database);
      const reportError = vi.fn();
      const disposed = createService({ repository, reportError });
      await begin(disposed, 'r1');
      disposed.dispose();
      const closed = () => {
        throw new Error('database is not open');
      };
      const touched = [
        vi.spyOn(repository, 'createSegment').mockImplementation(closed),
        vi.spyOn(repository, 'endSegment').mockImplementation(closed),
        vi.spyOn(repository, 'linkCatalogSession').mockImplementation(closed),
        vi.spyOn(repository, 'getSegmentByOwner').mockImplementation(closed)
      ];
      counts = [];

      await begin(disposed, 'r2');
      disposed.end('r1');
      disposed.linkCatalogSession('r1', 'session-1');
      await disposed.refresh('r1');

      for (const spy of touched) expect(spy).not.toHaveBeenCalled();
      expect(engine.snapshot).toHaveBeenCalledOnce();
      expect(reportError).not.toHaveBeenCalled();
      expect(counts).toEqual([]);
    });

    it('does not report the closed database a running refresh runs into', async () => {
      const repository = new ChangesRepository(database);
      const reportError = vi.fn();
      const disposing = createService({ repository, reportError });
      await begin(disposing, 'r1');
      const listing = deferred<ChangedFile[]>();
      engine.changedFiles.mockReturnValueOnce(listing.promise);
      counts = [];

      const running = disposing.refresh('r1');
      await vi.waitFor(() => expect(engine.changedFiles).toHaveBeenCalled());
      disposing.dispose();
      vi.spyOn(repository, 'getSegmentByOwner').mockImplementation(() => {
        throw new Error('database is not open');
      });
      listing.reject(new Error('database is not open'));
      await running;

      expect(reportError).not.toHaveBeenCalled();
      expect(counts).toEqual([]);
    });
  });

  it('refreshes a session once more when it ends', async () => {
    await begin(service, 'r1');
    counts = [];
    engine.changedFiles.mockResolvedValue([file('a.txt')]);
    service.end('r1');
    await vi.waitFor(() => expect(counts).toHaveLength(1));
    expect(service.counts()).toEqual([]);
    service.linkCatalogSession('r1', 'cat-1');
    expect(service.history(workspaceId).segments[0]).toMatchObject({ catalogSessionId: 'cat-1', endedAt: now.toISOString() });
  });

  it('only records sessions ending once the app is shutting down', async () => {
    vi.useFakeTimers();
    await begin(service, 'r1');
    await begin(service, 'c1', 'unified');
    service.startTerminalTimer();
    engine.snapshot.mockClear();
    engine.changedFiles.mockClear();
    counts = [];

    service.beginShutdown();
    service.end('r1');
    await service.refresh('c1');
    await vi.advanceTimersByTimeAsync(60_000);

    expect(service.history(workspaceId).segments.find(({ ownerId }) => ownerId === 'r1')?.endedAt)
      .toBe(now.toISOString());
    expect(engine.snapshot).not.toHaveBeenCalled();
    expect(engine.changedFiles).not.toHaveBeenCalled();
    expect(counts).toEqual([]);
  });

  it('ends open segments and prunes old ones at startup, removing stores left empty', async () => {
    await begin(service, 'r1');
    await service.startup();                                  // ends r1 at 2026-09-15
    now = new Date('2026-10-15T00:00:00.000Z');
    await service.startup();                                  // 30 days later: pruned
    expect(engine.removeWorkspace).toHaveBeenCalledWith(workspaceId);
    expect(service.history(workspaceId).segments).toEqual([]);
  });

  it('keeps a store at startup while other segments remain, and reports a store it could not remove', async () => {
    await begin(service, 'r1');
    await service.startup();
    now = new Date('2026-10-15T00:00:00.000Z');
    await begin(service, 'r2');
    await service.startup();
    expect(engine.removeWorkspace).not.toHaveBeenCalled();
    expect(service.history(workspaceId).segments.map(({ ownerId }) => ownerId)).toEqual(['r2']);

    const reported: string[] = [];
    const reporting = createService({ reportError: (operation) => { reported.push(operation); } });
    engine.removeWorkspace.mockRejectedValueOnce(new Error('locked'));
    now = new Date('2026-11-15T00:00:00.000Z');
    await reporting.startup();
    expect(engine.removeWorkspace).toHaveBeenCalledWith(workspaceId);
    expect(reported).toEqual(['startup']);
  });
});
