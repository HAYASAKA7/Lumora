import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CatalogRepository } from '../storage/catalog-repository';
import { ExecutionTargetRepository } from '../storage/execution-target-repository';
import { migrateCatalogDatabase } from '../storage/migrations';
import { ChangesRepository } from './changes-repository';

let database: DatabaseSync;
let repository: ChangesRepository;
const workspaceId = 'a'.repeat(64);

beforeEach(() => {
  database = new DatabaseSync(':memory:');
  migrateCatalogDatabase(database);
  new CatalogRepository(database).registerWorkspace(
    { id: workspaceId, canonicalPath: '/work', identityKey: '/work', displayName: 'work', available: true },
    'manual',
    '2026-09-15T00:00:00.000Z'
  );
  repository = new ChangesRepository(database);
});
afterEach(() => database.close());

describe('ChangesRepository', () => {
  it('creates a capturing segment, records its baseline, and ends it', () => {
    repository.createSegment({ id: 's1', workspaceId, ownerKind: 'terminal', ownerId: 'r1', catalogSessionId: null, createdAt: '2026-09-15T01:00:00.000Z' });
    expect(repository.getSegmentByOwner('r1')).toMatchObject({ state: 'capturing', baselineTree: null, baselineLate: false });
    repository.recordBaseline('s1', { snapshotKind: 'repository', tree: 't1', head: 'h1', late: true });
    repository.endSegment('r1', '2026-09-15T02:00:00.000Z');
    repository.endSegment('r1', '2026-09-15T03:00:00.000Z');
    expect(repository.getSegmentByOwner('r1')).toMatchObject({
      state: 'ready', snapshotKind: 'repository', baselineTree: 't1', baselineHead: 'h1', baselineLate: true, endedAt: '2026-09-15T02:00:00.000Z'
    });
    expect(repository.getSegment('s1')?.ownerId).toBe('r1');
  });

  it('keeps the places a workspace watches, newest last', () => {
    repository.addPlace({ id: 'p1', workspaceId, path: 'D:\Projects\lib', createdAt: '2026-09-17T01:00:00.000Z' });
    repository.addPlace({ id: 'p2', workspaceId, path: 'D:\Projects\docs', createdAt: '2026-09-17T02:00:00.000Z' });

    expect(repository.listPlaces(workspaceId).map(({ id, path }) => [id, path])).toEqual([
      ['p1', 'D:\Projects\lib'],
      ['p2', 'D:\Projects\docs']
    ]);
    expect(repository.getPlace('p1')?.workspaceId).toBe(workspaceId);
    expect(repository.getPlace('missing')).toBeNull();
  });

  it('gives each place its own baseline within a segment', () => {
    repository.createSegment({ id: 's1', workspaceId, ownerKind: 'terminal', ownerId: 'r1', catalogSessionId: null, createdAt: '2026-09-17T01:00:00.000Z' });
    repository.addPlace({ id: 'p1', workspaceId, path: 'D:\Projects\lib', createdAt: '2026-09-17T01:00:00.000Z' });
    repository.createRoot('s1', 'p1');
    repository.createRoot('s1', 'p1');

    expect(repository.listRoots('s1')).toEqual([{
      segmentId: 's1', placeId: 'p1', path: 'D:\Projects\lib', snapshotKind: null,
      baselineTree: null, baselineHead: null, baselineLate: false,
      state: 'capturing', unavailableReason: null
    }]);

    repository.recordRootBaseline('s1', 'p1', { snapshotKind: 'folder', tree: 't1', head: null, late: true });
    expect(repository.listRoots('s1')[0]).toMatchObject({
      state: 'ready', snapshotKind: 'folder', baselineTree: 't1', baselineLate: true
    });

    repository.markRootUnavailable('s1', 'p1', 'too-large');
    expect(repository.listRoots('s1')[0]).toMatchObject({ state: 'unavailable', unavailableReason: 'too-large' });
  });

  it('moves the reviewed place forward, leaving the workspace baseline alone', () => {
    repository.createSegment({ id: 's1', workspaceId, ownerKind: 'terminal', ownerId: 'r1', catalogSessionId: null, createdAt: '2026-09-17T01:00:00.000Z' });
    repository.recordBaseline('s1', { snapshotKind: 'repository', tree: 'w1', head: null, late: false });
    repository.addPlace({ id: 'p1', workspaceId, path: 'D:\Projects\lib', createdAt: '2026-09-17T01:00:00.000Z' });
    repository.createRoot('s1', 'p1');
    repository.recordRootBaseline('s1', 'p1', { snapshotKind: 'folder', tree: 'l1', head: null, late: false });

    repository.recordReview({ id: 'v1', segmentId: 's1', placeId: 'p1', fromTree: 'l1', toTree: 'l2', fileCount: 1, reviewedAt: '2026-09-17T01:10:00.000Z' });

    expect(repository.listRoots('s1')[0]?.baselineTree).toBe('l2');
    expect(repository.getSegment('s1')?.baselineTree).toBe('w1');
    expect(repository.getReview('v1')?.placeId).toBe('p1');
  });

  it('takes the baselines and batches of a place away with it', () => {
    repository.createSegment({ id: 's1', workspaceId, ownerKind: 'terminal', ownerId: 'r1', catalogSessionId: null, createdAt: '2026-09-17T01:00:00.000Z' });
    repository.addPlace({ id: 'p1', workspaceId, path: 'D:\Projects\lib', createdAt: '2026-09-17T01:00:00.000Z' });
    repository.createRoot('s1', 'p1');
    repository.recordRootBaseline('s1', 'p1', { snapshotKind: 'folder', tree: 'l1', head: null, late: false });
    repository.recordReview({ id: 'v1', segmentId: 's1', placeId: 'p1', fromTree: 'l1', toTree: 'l2', fileCount: 1, reviewedAt: '2026-09-17T01:10:00.000Z' });

    repository.removePlace('p1');

    expect(repository.listPlaces(workspaceId)).toEqual([]);
    expect(repository.listRoots('s1')).toEqual([]);
    expect(repository.listReviews('s1')).toEqual([]);
  });

  it('marks a segment unavailable with a reason', () => {
    repository.createSegment({ id: 's1', workspaceId, ownerKind: 'unified', ownerId: 'c1', catalogSessionId: 'cat', createdAt: '2026-09-15T01:00:00.000Z' });
    repository.markUnavailable('s1', 'git-missing');
    expect(repository.getSegmentByOwner('c1')).toMatchObject({ state: 'unavailable', unavailableReason: 'git-missing' });
  });

  it('moves the baseline forward on review and keeps the batch in history, newest first', () => {
    repository.createSegment({ id: 's1', workspaceId, ownerKind: 'terminal', ownerId: 'r1', catalogSessionId: null, createdAt: '2026-09-15T01:00:00.000Z' });
    repository.recordBaseline('s1', { snapshotKind: 'repository', tree: 't1', head: null, late: false });
    repository.recordReview({ placeId: null, id: 'v1', segmentId: 's1', fromTree: 't1', toTree: 't2', fileCount: 2, reviewedAt: '2026-09-15T01:10:00.000Z' });
    repository.recordReview({ placeId: null, id: 'v2', segmentId: 's1', fromTree: 't2', toTree: 't3', fileCount: 1, reviewedAt: '2026-09-15T01:20:00.000Z' });
    expect(repository.getSegmentByOwner('r1')?.baselineTree).toBe('t3');
    expect(repository.listReviews('s1').map(({ id }) => id)).toEqual(['v2', 'v1']);
    expect(repository.getReview('v1')).toEqual({ id: 'v1', segmentId: 's1', placeId: null, fromTree: 't1', toTree: 't2', fileCount: 2, reviewedAt: '2026-09-15T01:10:00.000Z' });
    expect(repository.getReview('missing')).toBeNull();
  });

  it('keeps the baseline when recording a review fails', () => {
    repository.createSegment({ id: 's1', workspaceId, ownerKind: 'terminal', ownerId: 'r1', catalogSessionId: null, createdAt: '2026-09-15T01:00:00.000Z' });
    repository.recordBaseline('s1', { snapshotKind: 'repository', tree: 't1', head: null, late: false });
    expect(() => repository.recordReview({ placeId: null, id: 'v1', segmentId: 's1', fromTree: 't1', toTree: 't2', fileCount: -1, reviewedAt: '2026-09-15T01:10:00.000Z' })).toThrow();
    expect(repository.getSegmentByOwner('r1')?.baselineTree).toBe('t1');
    expect(repository.listReviews('s1')).toEqual([]);
  });

  it('refuses a review whose starting tree is no longer the baseline', () => {
    repository.createSegment({ id: 's1', workspaceId, ownerKind: 'terminal', ownerId: 'r1', catalogSessionId: null, createdAt: '2026-09-15T01:00:00.000Z' });
    repository.recordBaseline('s1', { snapshotKind: 'repository', tree: 't1', head: null, late: false });
    repository.recordReview({ placeId: null, id: 'v1', segmentId: 's1', fromTree: 't1', toTree: 't2', fileCount: 1, reviewedAt: '2026-09-15T01:10:00.000Z' });
    expect(() => repository.recordReview({ placeId: null, id: 'v2', segmentId: 's1', fromTree: 't1', toTree: 't3', fileCount: 1, reviewedAt: '2026-09-15T01:20:00.000Z' })).toThrow();
    expect(repository.getSegmentByOwner('r1')?.baselineTree).toBe('t2');
    expect(repository.listReviews('s1').map(({ id }) => id)).toEqual(['v1']);
  });

  it('tells whether another open segment shares the workspace', () => {
    repository.createSegment({ id: 's1', workspaceId, ownerKind: 'terminal', ownerId: 'r1', catalogSessionId: null, createdAt: '2026-09-15T01:00:00.000Z' });
    expect(repository.hasOtherOpenSegment(workspaceId, 'r1')).toBe(false);
    repository.createSegment({ id: 's2', workspaceId, ownerKind: 'unified', ownerId: 'c1', catalogSessionId: null, createdAt: '2026-09-15T01:00:00.000Z' });
    expect(repository.hasOtherOpenSegment(workspaceId, 'r1')).toBe(true);
    repository.endSegment('c1', '2026-09-15T02:00:00.000Z');
    expect(repository.hasOtherOpenSegment(workspaceId, 'r1')).toBe(false);
  });

  it('limits listed segments and reviews', () => {
    for (const index of [1, 2, 3]) {
      repository.createSegment({ id: `s${index}`, workspaceId, ownerKind: 'terminal', ownerId: `r${index}`, catalogSessionId: null, createdAt: `2026-09-15T0${index}:00:00.000Z` });
    }
    repository.recordBaseline('s1', { snapshotKind: 'repository', tree: 't1', head: null, late: false });
    repository.recordReview({ placeId: null, id: 'v1', segmentId: 's1', fromTree: 't1', toTree: 't2', fileCount: 1, reviewedAt: '2026-09-15T01:10:00.000Z' });
    repository.recordReview({ placeId: null, id: 'v2', segmentId: 's1', fromTree: 't2', toTree: 't3', fileCount: 1, reviewedAt: '2026-09-15T01:20:00.000Z' });
    expect(repository.listWorkspaceSegments(workspaceId, 2).map(({ id }) => id)).toEqual(['s3', 's2']);
    expect(repository.listReviews('s1', 1).map(({ id }) => id)).toEqual(['v2']);
  });

  it('keeps owner ids unique within one execution target only', () => {
    const remoteId = '2abb0a0d-0a65-4027-8919-ff8cc9b9aefb';
    const remoteWorkspaceId = 'b'.repeat(64);
    new ExecutionTargetRepository(database).createRemote({ id: remoteId, displayName: 'Build server' });
    new CatalogRepository(database, remoteId).registerWorkspace(
      { id: remoteWorkspaceId, canonicalPath: '/work', identityKey: '/work', displayName: 'work', available: true },
      'manual',
      '2026-09-15T00:00:00.000Z'
    );
    const remote = new ChangesRepository(database, remoteId);
    repository.createSegment({ id: 's1', workspaceId, ownerKind: 'terminal', ownerId: 'r1', catalogSessionId: null, createdAt: '2026-09-15T01:00:00.000Z' });
    remote.createSegment({ id: 's2', workspaceId: remoteWorkspaceId, ownerKind: 'terminal', ownerId: 'r1', catalogSessionId: null, createdAt: '2026-09-15T01:00:00.000Z' });
    expect(repository.getSegmentByOwner('r1')?.id).toBe('s1');
    expect(remote.getSegmentByOwner('r1')?.id).toBe('s2');
    expect(remote.listOpenSegments().map(({ id }) => id)).toEqual(['s2']);
  });

  it('lists a workspace\'s segments newest first, links a catalog session, and prunes ended segments', () => {
    repository.createSegment({ id: 's1', workspaceId, ownerKind: 'terminal', ownerId: 'r1', catalogSessionId: null, createdAt: '2026-09-01T00:00:00.000Z' });
    repository.createSegment({ id: 's2', workspaceId, ownerKind: 'unified', ownerId: 'c1', catalogSessionId: null, createdAt: '2026-09-14T00:00:00.000Z' });
    repository.endSegment('r1', '2026-09-01T01:00:00.000Z');
    repository.linkCatalogSession('c1', 'cat-1');
    expect(repository.listWorkspaceSegments(workspaceId).map(({ id, catalogSessionId }) => [id, catalogSessionId]))
      .toEqual([['s2', 'cat-1'], ['s1', null]]);
    expect(repository.listOpenSegments().map(({ id }) => id)).toEqual(['s2']);
    expect(repository.pruneEndedBefore('2026-09-10T00:00:00.000Z')).toEqual([{ segmentId: 's1', workspaceId }]);
    expect(repository.listWorkspaceSegments(workspaceId).map(({ id }) => id)).toEqual(['s2']);
    expect(repository.hasSegments(workspaceId)).toBe(true);
  });

  it('skips linking a catalog session that is already linked', () => {
    repository.createSegment({ id: 's1', workspaceId, ownerKind: 'terminal', ownerId: 'r1', catalogSessionId: null, createdAt: '2026-09-15T01:00:00.000Z' });
    const writes = () => (database.prepare('SELECT total_changes() AS count').get() as { count: number }).count;

    repository.linkCatalogSession('r1', 'cat-1');
    const afterLink = writes();
    repository.linkCatalogSession('r1', 'cat-1');
    expect(writes()).toBe(afterLink);

    repository.linkCatalogSession('r1', 'cat-2');
    expect(writes()).toBe(afterLink + 1);
    expect(repository.getSegmentByOwner('r1')?.catalogSessionId).toBe('cat-2');
  });

  it('ends every open segment at startup', () => {
    repository.createSegment({ id: 's1', workspaceId, ownerKind: 'terminal', ownerId: 'r1', catalogSessionId: null, createdAt: '2026-09-15T01:00:00.000Z' });
    repository.endOpenSegments('2026-09-15T03:00:00.000Z');
    expect(repository.getSegmentByOwner('r1')?.endedAt).toBe('2026-09-15T03:00:00.000Z');
  });

  it('refuses a segment for an unknown workspace or a second segment for the same owner', () => {
    repository.createSegment({ id: 's1', workspaceId, ownerKind: 'terminal', ownerId: 'r1', catalogSessionId: null, createdAt: '2026-09-15T01:00:00.000Z' });
    expect(() => repository.createSegment({ id: 's2', workspaceId, ownerKind: 'terminal', ownerId: 'r1', catalogSessionId: null, createdAt: '2026-09-15T01:00:00.000Z' })).toThrow();
    expect(() => repository.createSegment({ id: 's3', workspaceId: 'b'.repeat(64), ownerKind: 'terminal', ownerId: 'r3', catalogSessionId: null, createdAt: '2026-09-15T01:00:00.000Z' })).toThrow();
  });

  it('removes a workspace\'s segments and reviews when the workspace is deleted', () => {
    repository.createSegment({ id: 's1', workspaceId, ownerKind: 'terminal', ownerId: 'r1', catalogSessionId: null, createdAt: '2026-09-15T01:00:00.000Z' });
    repository.recordBaseline('s1', { snapshotKind: 'folder', tree: 't1', head: null, late: false });
    repository.recordReview({ placeId: null, id: 'v1', segmentId: 's1', fromTree: 't1', toTree: 't2', fileCount: 1, reviewedAt: '2026-09-15T01:10:00.000Z' });
    database.prepare('DELETE FROM workspace WHERE execution_target_id = ? AND id = ?').run('local', workspaceId);
    expect(repository.getSegment('s1')).toBeNull();
    expect(repository.getReview('v1')).toBeNull();
    expect(repository.hasSegments(workspaceId)).toBe(false);
  });
});
