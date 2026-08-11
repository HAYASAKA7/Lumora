import { describe, expect, it, vi } from 'vitest';

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

  it('composes the encrypted credential repository with the supplied OS backend', async () => {
    const runtime = createRemoteTargetRuntime({
      databasePath: ':memory:',
      createTargetId: () => '3dfeaa39-7779-45c8-995c-f13b4a2f47bc',
      credentialEncryption: {
        platform: 'win32',
        isEncryptionAvailable: vi.fn(() => true),
        isAsyncEncryptionAvailable: vi.fn(async () => true),
        getSelectedStorageBackend: vi.fn(() => 'unknown'),
        encryptStringAsync: vi.fn(async (value: string) => Buffer.from(value)),
        decryptStringAsync: vi.fn(async (value: Buffer) => ({
          result: value.toString(),
          shouldReEncrypt: false
        }))
      }
    });
    const created = runtime.service.create({
      displayName: 'Secure host',
      route: 'direct',
      host: 'secure.internal',
      port: 22,
      username: 'builder',
      authentication: { method: 'password' }
    });

    await expect(runtime.service.getCredentialStatus(created.target.id))
      .resolves.toMatchObject({
        storageState: 'available',
        credentialState: 'none',
        autoConnect: false
      });
    await runtime.close();
  });
});
