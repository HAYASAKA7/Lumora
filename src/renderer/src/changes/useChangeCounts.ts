import { useEffect, useState } from 'react';

import type { LumoraApi } from '../../../shared/contracts';

type ChangeCountsApi = Pick<LumoraApi, 'getChangesCounts' | 'onChangesCount'>;

/**
 * Changed file counts by session owner id: loaded once and kept current by
 * count events. A count event is newer than the initial load, so the load
 * never replaces one.
 */
export function useChangeCounts(api: ChangeCountsApi): ReadonlyMap<string, number> {
  const [counts, setCounts] = useState<ReadonlyMap<string, number>>(() => new Map());

  useEffect(() => {
    let current = true;
    const unsubscribe = api.onChangesCount((count) => {
      setCounts((existing) => new Map(existing).set(count.ownerId, count.changedFileCount));
    });
    api.getChangesCounts().then(
      (loaded) => {
        if (!current) return;
        setCounts((existing) => {
          const next = new Map(loaded.map((count) => [count.ownerId, count.changedFileCount] as const));
          for (const [ownerId, count] of existing) next.set(ownerId, count);
          return next;
        });
      },
      () => undefined
    );
    return () => {
      current = false;
      unsubscribe();
    };
  }, [api]);

  return counts;
}
