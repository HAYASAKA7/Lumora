import type { RemoteExecutionTargetId } from '../../shared/contracts';
import type {
  RemoteCredentialKind,
  StoredRemoteCredential
} from '../storage/remote-credential-repository';

export type RemoteCredentialStorageState =
  | 'available'
  | 'unavailable'
  | 'temporarily-unavailable';
export type RemoteCredentialState = 'none' | 'remembered' | 'needs-attention';
export type RemoteCredentialVaultErrorCode =
  | 'STORAGE_UNAVAILABLE'
  | 'CREDENTIAL_UNAVAILABLE'
  | 'CREDENTIAL_KIND_MISMATCH';

export interface RemoteCredentialEncryptionBackend {
  platform: NodeJS.Platform;
  isEncryptionAvailable(): boolean;
  isAsyncEncryptionAvailable(): Promise<boolean>;
  getSelectedStorageBackend(): string;
  encryptStringAsync(value: string): Promise<Buffer>;
  decryptStringAsync(value: Buffer): Promise<{
    result: string;
    shouldReEncrypt: boolean;
  }>;
}

interface RemoteCredentialStore {
  getCredential(id: RemoteExecutionTargetId): StoredRemoteCredential | null;
  saveCredential(
    id: RemoteExecutionTargetId,
    kind: RemoteCredentialKind,
    encryptedSecret: Uint8Array,
    encryptionVersion: number
  ): void;
  deleteCredential(id: RemoteExecutionTargetId): void;
}

export class RemoteCredentialVaultError extends Error {
  constructor(readonly code: RemoteCredentialVaultErrorCode) {
    super(
      code === 'STORAGE_UNAVAILABLE'
        ? 'Secure credential storage is unavailable.'
        : 'Lumora could not use the remembered remote credential.'
    );
    this.name = 'RemoteCredentialVaultError';
  }
}

export class RemoteCredentialVault {
  private readonly needsAttention = new Set<RemoteExecutionTargetId>();

  constructor(
    private readonly repository: RemoteCredentialStore,
    private readonly encryption: RemoteCredentialEncryptionBackend
  ) {}

  async getStorageState(): Promise<RemoteCredentialStorageState> {
    if (
      this.encryption.platform === 'linux' &&
      this.encryption.getSelectedStorageBackend() === 'basic_text'
    ) {
      return 'unavailable';
    }
    if (!this.encryption.isEncryptionAvailable()) {
      return 'temporarily-unavailable';
    }
    try {
      return await this.encryption.isAsyncEncryptionAvailable()
        ? 'available'
        : 'temporarily-unavailable';
    } catch {
      return 'temporarily-unavailable';
    }
  }

  getCredentialState(id: RemoteExecutionTargetId): RemoteCredentialState {
    if (this.needsAttention.has(id)) return 'needs-attention';
    return this.repository.getCredential(id) === null ? 'none' : 'remembered';
  }

  async save(
    id: RemoteExecutionTargetId,
    kind: RemoteCredentialKind,
    secret: string
  ): Promise<void> {
    if (secret.length < 1 || secret.length > 4096) {
      throw new RemoteCredentialVaultError('CREDENTIAL_UNAVAILABLE');
    }
    await this.requireAvailable();
    try {
      const encrypted = await this.encryption.encryptStringAsync(secret);
      if (encrypted.byteLength === 0) {
        throw new Error('empty encrypted value');
      }
      this.repository.saveCredential(id, kind, Buffer.from(encrypted), 1);
      this.needsAttention.delete(id);
    } catch (error) {
      if (error instanceof RemoteCredentialVaultError) throw error;
      throw new RemoteCredentialVaultError('CREDENTIAL_UNAVAILABLE');
    }
  }

  async resolve(
    id: RemoteExecutionTargetId,
    expectedKind: RemoteCredentialKind
  ): Promise<string | null> {
    const stored = this.repository.getCredential(id);
    if (stored === null) return null;
    if (stored.kind !== expectedKind) {
      throw new RemoteCredentialVaultError('CREDENTIAL_KIND_MISMATCH');
    }
    await this.requireAvailable();
    try {
      const decrypted = await this.encryption.decryptStringAsync(
        Buffer.from(stored.encryptedSecret)
      );
      if (decrypted.result.length < 1 || decrypted.result.length > 4096) {
        throw new Error('invalid decrypted value');
      }
      if (decrypted.shouldReEncrypt) {
        const encrypted = await this.encryption.encryptStringAsync(
          decrypted.result
        );
        this.repository.saveCredential(
          id,
          stored.kind,
          Buffer.from(encrypted),
          stored.encryptionVersion + 1
        );
      }
      this.needsAttention.delete(id);
      return decrypted.result;
    } catch {
      this.needsAttention.add(id);
      throw new RemoteCredentialVaultError('CREDENTIAL_UNAVAILABLE');
    }
  }

  forget(id: RemoteExecutionTargetId): void {
    this.repository.deleteCredential(id);
    this.needsAttention.delete(id);
  }

  private async requireAvailable(): Promise<void> {
    if (await this.getStorageState() !== 'available') {
      throw new RemoteCredentialVaultError('STORAGE_UNAVAILABLE');
    }
  }
}
