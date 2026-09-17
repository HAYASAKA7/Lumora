import { describe, expect, it, vi } from 'vitest';

import { SnapshotCache } from './snapshot-cache';
import type { Snapshot } from './snapshot-targets';

const TTL_MS = 2_000;

const snapshotOf = (tree: string): Snapshot => ({ kind: 'repository', tree, head: null });

function setup(ttlMs = TTL_MS) {
  let now = 1_000;
  let taken = 0;
  const snapshot = vi.fn(async () => snapshotOf(`tree-${++taken}`));
  const cache = new SnapshotCache({ snapshot }, () => new Date(now), ttlMs);
  return {
    cache,
    snapshot,
    advance: (ms: number) => {
      now += ms;
    }
  };
}

describe('SnapshotCache', () => {
  it('shares one snapshot between views taken within the same moment', async () => {
    const { cache, snapshot } = setup();

    await expect(cache.get('ws-1', '/work/ws-1', false)).resolves.toEqual(snapshotOf('tree-1'));
    await expect(cache.get('ws-1', '/work/ws-1', false)).resolves.toEqual(snapshotOf('tree-1'));

    expect(snapshot).toHaveBeenCalledExactlyOnceWith('ws-1', '/work/ws-1');
  });

  it('keeps each workspace apart and takes a new snapshot once the cache is stale', async () => {
    const { advance, cache, snapshot } = setup();

    await cache.get('ws-1', '/work/ws-1', false);
    await cache.get('ws-2', '/work/ws-2', false);
    expect(snapshot).toHaveBeenCalledTimes(2);

    advance(TTL_MS - 1);
    await expect(cache.get('ws-1', '/work/ws-1', false)).resolves.toEqual(snapshotOf('tree-1'));
    expect(snapshot).toHaveBeenCalledTimes(2);

    advance(1);
    await expect(cache.get('ws-1', '/work/ws-1', false)).resolves.toEqual(snapshotOf('tree-3'));
    expect(snapshot).toHaveBeenCalledTimes(3);
  });

  it('takes a fresh snapshot on request and keeps it for the next reader', async () => {
    const { cache, snapshot } = setup();

    await cache.get('ws-1', '/work/ws-1', false);
    await expect(cache.get('ws-1', '/work/ws-1', true)).resolves.toEqual(snapshotOf('tree-2'));
    expect(snapshot).toHaveBeenCalledTimes(2);

    await expect(cache.get('ws-1', '/work/ws-1', false)).resolves.toEqual(snapshotOf('tree-2'));
    expect(snapshot).toHaveBeenCalledTimes(2);
  });

  it('caches each watched folder of a workspace on its own', async () => {
    const { cache, snapshot } = setup();

    await expect(cache.get('ws-1', '/work/ws-1', false)).resolves.toEqual(snapshotOf('tree-1'));
    await expect(cache.get('ws-1', '/work/lib', false)).resolves.toEqual(snapshotOf('tree-2'));
    expect(snapshot).toHaveBeenCalledTimes(2);

    cache.delete('ws-1');
    await cache.get('ws-1', '/work/lib', false);
    expect(snapshot).toHaveBeenCalledTimes(3);
  });

  it('reuses a snapshot taken elsewhere, such as a session baseline', async () => {
    const { advance, cache, snapshot } = setup();

    cache.set('ws-1', '/work/ws-1', snapshotOf('baseline'));

    await expect(cache.get('ws-1', '/work/ws-1', false)).resolves.toEqual(snapshotOf('baseline'));
    expect(snapshot).not.toHaveBeenCalled();

    advance(TTL_MS);
    await expect(cache.get('ws-1', '/work/ws-1', false)).resolves.toEqual(snapshotOf('tree-1'));
    expect(snapshot).toHaveBeenCalledOnce();
  });

  it('keeps no failed snapshot, so the next reader tries again', async () => {
    const { cache, snapshot } = setup();
    snapshot.mockRejectedValueOnce(new Error('git failed'));

    await expect(cache.get('ws-1', '/work/ws-1', false)).rejects.toThrow('git failed');
    await expect(cache.get('ws-1', '/work/ws-1', false)).resolves.toEqual(snapshotOf('tree-1'));

    expect(snapshot).toHaveBeenCalledTimes(2);
  });

  it('drops a workspace on request', async () => {
    const { cache, snapshot } = setup();

    await cache.get('ws-1', '/work/ws-1', false);
    cache.delete('ws-1');
    await expect(cache.get('ws-1', '/work/ws-1', false)).resolves.toEqual(snapshotOf('tree-2'));

    expect(snapshot).toHaveBeenCalledTimes(2);
  });
});
