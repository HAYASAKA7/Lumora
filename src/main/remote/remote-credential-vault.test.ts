import { describe, expect, it, vi } from 'vitest';

import type {
  RemoteCredentialKind,
  StoredRemoteCredential
} from '../storage/remote-credential-repository';
import {
  RemoteCredentialVault,
  RemoteCredentialVaultError,
  type RemoteCredentialEncryptionBackend
} from './remote-credential-vault';

const TARGET_ID = '4f632901-1f8d-44c0-8418-aa823f791ca0';

function repository() {
  const values = new Map<string, StoredRemoteCredential>();
  return {
    values,
    getCredential: vi.fn((id: string) => values.get(id) ?? null),
    saveCredential: vi.fn((
      id: string,
      kind: RemoteCredentialKind,
      encryptedSecret: Uint8Array,
      encryptionVersion: number
    ) => {
      values.set(id, {
        executionTargetId: id as typeof TARGET_ID,
        kind,
        encryptedSecret: Buffer.from(encryptedSecret),
        encryptionVersion,
        createdAt: '2026-08-11T06:00:00.000Z',
        updatedAt: '2026-08-11T06:00:00.000Z'
      });
    }),
    deleteCredential: vi.fn((id: string) => values.delete(id))
  };
}

function backend(
  overrides: Partial<RemoteCredentialEncryptionBackend> = {}
): RemoteCredentialEncryptionBackend {
  return {
    platform: 'win32',
    isEncryptionAvailable: vi.fn(() => true),
    isAsyncEncryptionAvailable: vi.fn(async () => true),
    getSelectedStorageBackend: vi.fn(() => 'unknown'),
    encryptStringAsync: vi.fn(async (value: string) =>
      Buffer.from(`encrypted:${value}`, 'utf8')
    ),
    decryptStringAsync: vi.fn(async (value: Buffer) => ({
      result: value.toString('utf8').replace(/^encrypted:/, ''),
      shouldReEncrypt: false
    })),
    ...overrides
  };
}

describe('RemoteCredentialVault', () => {
  it('reports secure async storage as available', async () => {
    const vault = new RemoteCredentialVault(repository(), backend());

    await expect(vault.getStorageState()).resolves.toBe('available');
  });

  it('rejects Linux basic_text instead of storing an insecure fallback', async () => {
    const encryption = backend({
      platform: 'linux',
      getSelectedStorageBackend: vi.fn(() => 'basic_text')
    });
    const vault = new RemoteCredentialVault(repository(), encryption);

    await expect(vault.getStorageState()).resolves.toBe('unavailable');
    await expect(vault.save(TARGET_ID, 'password', 'secret')).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE'
    });
    expect(encryption.encryptStringAsync).not.toHaveBeenCalled();
  });

  it('encrypts, resolves, and forgets credentials without exposing plaintext storage', async () => {
    const stored = repository();
    const vault = new RemoteCredentialVault(stored, backend());

    await vault.save(TARGET_ID, 'password', 'memory-only');
    expect(stored.saveCredential).toHaveBeenCalledWith(
      TARGET_ID,
      'password',
      Buffer.from('encrypted:memory-only'),
      1
    );
    expect(vault.getCredentialState(TARGET_ID)).toBe('remembered');
    await expect(vault.resolve(TARGET_ID, 'password')).resolves.toBe('memory-only');

    vault.forget(TARGET_ID);
    expect(vault.getCredentialState(TARGET_ID)).toBe('none');
    vault.forget(TARGET_ID);
    expect(stored.deleteCredential).toHaveBeenCalledTimes(2);
  });

  it('rejects a mismatched credential kind without decrypting it', async () => {
    const stored = repository();
    stored.values.set(TARGET_ID, {
      executionTargetId: TARGET_ID,
      kind: 'password',
      encryptedSecret: Buffer.from('encrypted:secret'),
      encryptionVersion: 1,
      createdAt: '2026-08-11T06:00:00.000Z',
      updatedAt: '2026-08-11T06:00:00.000Z'
    });
    const encryption = backend();
    const vault = new RemoteCredentialVault(stored, encryption);

    await expect(vault.resolve(TARGET_ID, 'private-key-passphrase'))
      .rejects.toBeInstanceOf(RemoteCredentialVaultError);
    expect(encryption.decryptStringAsync).not.toHaveBeenCalled();
  });

  it('rotates ciphertext after an async decrypt requests re-encryption', async () => {
    const stored = repository();
    stored.values.set(TARGET_ID, {
      executionTargetId: TARGET_ID,
      kind: 'password',
      encryptedSecret: Buffer.from('old'),
      encryptionVersion: 2,
      createdAt: '2026-08-11T06:00:00.000Z',
      updatedAt: '2026-08-11T06:00:00.000Z'
    });
    const vault = new RemoteCredentialVault(stored, backend({
      decryptStringAsync: vi.fn(async () => ({
        result: 'rotated-secret',
        shouldReEncrypt: true
      }))
    }));

    await expect(vault.resolve(TARGET_ID, 'password')).resolves.toBe('rotated-secret');
    expect(stored.saveCredential).toHaveBeenLastCalledWith(
      TARGET_ID,
      'password',
      Buffer.from('encrypted:rotated-secret'),
      3
    );
  });

  it('marks corrupt ciphertext as needing attention and returns a sanitized error', async () => {
    const stored = repository();
    stored.values.set(TARGET_ID, {
      executionTargetId: TARGET_ID,
      kind: 'password',
      encryptedSecret: Buffer.from('broken'),
      encryptionVersion: 1,
      createdAt: '2026-08-11T06:00:00.000Z',
      updatedAt: '2026-08-11T06:00:00.000Z'
    });
    const vault = new RemoteCredentialVault(stored, backend({
      decryptStringAsync: vi.fn(async () => {
        throw new Error('raw keychain failure');
      })
    }));

    await expect(vault.resolve(TARGET_ID, 'password')).rejects.toMatchObject({
      code: 'CREDENTIAL_UNAVAILABLE',
      message: 'Lumora could not use the remembered remote credential.'
    });
    expect(vault.getCredentialState(TARGET_ID)).toBe('needs-attention');
  });
});
