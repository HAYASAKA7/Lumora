import { describe, expect, it } from 'vitest';

import { createExecutionTargetGateway } from './execution-target-gateway';

const localContext = {
  mode: 'local',
  executionTargetId: 'local'
} as const;
const remoteTargetId = '4f632901-1f8d-44c0-8418-aa823f791ca0';
const remoteContext = {
  mode: 'remote',
  executionTargetId: remoteTargetId
} as const;

describe('createExecutionTargetGateway', () => {
  it('resolves a service strictly from an authorized window context', () => {
    const gateway = createExecutionTargetGateway<{ name: string }>();
    const local = Object.freeze({ name: 'local' });
    const remote = Object.freeze({ name: 'remote' });
    gateway.register('local', local);
    gateway.register(remoteTargetId, remote);

    expect(gateway.resolve(localContext)).toBe(local);
    expect(gateway.resolve(remoteContext)).toBe(remote);
  });

  it('rejects unknown targets and duplicate registration', () => {
    const gateway = createExecutionTargetGateway<{ name: string }>();
    gateway.register('local', { name: 'local' });

    expect(() => gateway.register('local', { name: 'replacement' })).toThrow(
      'already registered'
    );
    expect(() => gateway.resolve(remoteContext)).toThrow('not available');
  });

  it('validates context shape before routing', () => {
    const gateway = createExecutionTargetGateway<{ name: string }>();
    gateway.register('local', { name: 'local' });

    expect(() => gateway.resolve({
      mode: 'local',
      executionTargetId: remoteTargetId
    } as never)).toThrow();
  });
});
