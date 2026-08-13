import { describe, expect, it } from 'vitest';

import { mapWithConcurrency } from './map-with-concurrency';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('mapWithConcurrency', () => {
  it('bounds active work and preserves input order', async () => {
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()];
    let active = 0;
    let maximumActive = 0;
    const pending = mapWithConcurrency([3, 1, 2], 2, async (value, index) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await gates[index]!.promise;
      active -= 1;
      return value * 10;
    });

    await Promise.resolve();
    expect(maximumActive).toBe(2);
    gates[1]!.resolve();
    await Promise.resolve();
    expect(maximumActive).toBe(2);
    gates[0]!.resolve();
    gates[2]!.resolve();

    await expect(pending).resolves.toEqual([30, 10, 20]);
    expect(maximumActive).toBe(2);
  });

  it('normalizes invalid limits and handles empty input', async () => {
    await expect(mapWithConcurrency([], 0, async (value) => value)).resolves.toEqual([]);
    await expect(
      mapWithConcurrency([1, 2], Number.NaN, async (value) => value)
    ).resolves.toEqual([1, 2]);
  });
});
