import { describe, expect, it, vi } from 'vitest';

import { createSingleWindowCreationGate } from './single-window-creation';

function deferred() {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve: () => resolve?.() };
}

describe('createSingleWindowCreationGate', () => {
  it('coalesces activation requests while asynchronous preparation is pending', async () => {
    const preparation = deferred();
    const prepare = vi.fn(async () => {
      await preparation.promise;
      return 'restored state';
    });
    const create = vi.fn();
    const gate = createSingleWindowCreationGate({
      canCreate: () => true,
      prepare,
      create
    });

    const first = gate.ensureCreated();
    const second = gate.ensureCreated();

    expect(second).toBe(first);
    expect(prepare).toHaveBeenCalledOnce();
    preparation.resolve();
    await first;
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith('restored state');
  });

  it('rechecks eligibility after preparation before committing a window', async () => {
    let canCreate = true;
    const preparation = deferred();
    const create = vi.fn();
    const gate = createSingleWindowCreationGate({
      canCreate: () => canCreate,
      prepare: async () => {
        await preparation.promise;
        return 'restored state';
      },
      create
    });

    const creation = gate.ensureCreated();
    canCreate = false;
    preparation.resolve();
    await creation;

    expect(create).not.toHaveBeenCalled();
  });

  it('allows a later creation after the previous operation settles', async () => {
    let windowExists = false;
    const create = vi.fn(() => {
      windowExists = true;
    });
    const gate = createSingleWindowCreationGate({
      canCreate: () => !windowExists,
      prepare: vi.fn().mockResolvedValue('restored state'),
      create
    });

    await gate.ensureCreated();
    await gate.ensureCreated();
    expect(create).toHaveBeenCalledOnce();

    windowExists = false;
    await gate.ensureCreated();
    expect(create).toHaveBeenCalledTimes(2);
  });
});
