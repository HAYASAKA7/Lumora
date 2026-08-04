import { describe, expect, it } from 'vitest';

import { createWindowContextRegistry } from './window-context-registry';

const localContext = {
  mode: 'local',
  executionTargetId: 'local'
} as const;

const remoteContext = {
  mode: 'remote',
  executionTargetId: '4f632901-1f8d-44c0-8418-aa823f791ca0'
} as const;

describe('createWindowContextRegistry', () => {
  it('registers and removes a target-bound window context', () => {
    const registry = createWindowContextRegistry();

    registry.register(41, localContext);
    expect(registry.get(41)).toEqual(localContext);

    registry.unregister(41);
    expect(registry.get(41)).toBeNull();
  });

  it('allows idempotent registration of the same context', () => {
    const registry = createWindowContextRegistry();

    registry.register(41, localContext);
    registry.register(41, localContext);

    expect(registry.get(41)).toEqual(localContext);
  });

  it('rejects rebinding one sender to another execution target', () => {
    const registry = createWindowContextRegistry();
    registry.register(41, localContext);

    expect(() => registry.register(41, remoteContext)).toThrow(
      'already bound'
    );
    expect(registry.get(41)).toEqual(localContext);
  });

  it('rejects invalid Electron sender identifiers', () => {
    const registry = createWindowContextRegistry();

    expect(() => registry.register(0, localContext)).toThrow(
      'positive safe integer'
    );
    expect(() => registry.register(Number.NaN, localContext)).toThrow(
      'positive safe integer'
    );
  });

  it('stores an immutable copy instead of the caller object', () => {
    const registry = createWindowContextRegistry();
    const mutable: { mode: 'remote'; executionTargetId: string } = {
      mode: 'remote',
      executionTargetId: remoteContext.executionTargetId
    };

    registry.register(41, mutable);
    mutable.executionTargetId = 'b68e04a7-c512-40b0-ab7d-d97aec347b92';

    expect(registry.get(41)).toEqual(remoteContext);
    expect(Object.isFrozen(registry.get(41))).toBe(true);
  });
});
