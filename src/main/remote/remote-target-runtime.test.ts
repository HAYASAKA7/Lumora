import { describe, expect, it } from 'vitest';

import { createRemoteTargetRuntime } from './remote-target-runtime';

describe('createRemoteTargetRuntime', () => {
  it('composes migrated target storage and closes it idempotently', () => {
    const runtime = createRemoteTargetRuntime({
      databasePath: ':memory:',
      clock: () => new Date('2026-08-04T09:00:00.000Z'),
      createTargetId: () => '3dfeaa39-7779-45c8-995c-f13b4a2f47bc'
    });

    const created = runtime.service.create({
      displayName: 'Mac build host',
      route: 'direct',
      host: 'mac-build.internal',
      port: 22,
      username: 'builder',
      authentication: { method: 'agent' }
    });
    expect(created).toMatchObject({
      target: {
        id: '3dfeaa39-7779-45c8-995c-f13b4a2f47bc',
        connectionState: 'offline'
      },
      profile: {
        host: 'mac-build.internal',
        authentication: { method: 'agent' }
      }
    });
    expect(runtime.service.saveProviderPreferences(created.target.id, {
      enabledProviders: ['codex']
    })).toEqual({ enabledProviders: ['codex'] });
    expect(runtime.service.getProviderPreferences(created.target.id)).toEqual({
      enabledProviders: ['codex']
    });
    expect(runtime.service.list()).toHaveLength(1);
    expect(runtime.close).not.toThrow();
    expect(runtime.close).not.toThrow();
  });
});
