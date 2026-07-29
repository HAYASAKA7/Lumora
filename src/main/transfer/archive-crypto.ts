import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt,
  type CipherGCM,
  type DecipherGCM
} from 'node:crypto';

export const GCM_TAG_BYTES = 16;
export const SCRYPT_OPTIONS = Object.freeze({
  N: 1 << 15,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024
});

export interface ArchiveEncryptionMaterial {
  salt: Buffer;
  nonce: Buffer;
}

export function createEncryptionMaterial(): ArchiveEncryptionMaterial {
  return { salt: randomBytes(16), nonce: randomBytes(12) };
}

export async function deriveArchiveKey(
  password: string,
  salt: Uint8Array
): Promise<Buffer> {
  if (password.length < 1 || password.length > 1_024) {
    throw new RangeError('Archive passwords must contain between 1 and 1,024 characters.');
  }
  if (salt.byteLength !== 16) {
    throw new RangeError('Archive salts must contain exactly 16 bytes.');
  }
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, SCRYPT_OPTIONS, (error, key) => {
      if (error) reject(error);
      else resolve(Buffer.from(key));
    });
  });
}

function assertCryptoInputs(key: Uint8Array, nonce: Uint8Array): void {
  if (key.byteLength !== 32) {
    throw new RangeError('Archive encryption keys must contain exactly 32 bytes.');
  }
  if (nonce.byteLength !== 12) {
    throw new RangeError('Archive nonces must contain exactly 12 bytes.');
  }
}

export function createArchiveCipher(
  key: Uint8Array,
  nonce: Uint8Array,
  additionalAuthenticatedData: Uint8Array
): CipherGCM {
  assertCryptoInputs(key, nonce);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(additionalAuthenticatedData);
  return cipher;
}

export function createArchiveDecipher(
  key: Uint8Array,
  nonce: Uint8Array,
  additionalAuthenticatedData: Uint8Array,
  authenticationTag: Uint8Array
): DecipherGCM {
  assertCryptoInputs(key, nonce);
  if (authenticationTag.byteLength !== GCM_TAG_BYTES) {
    throw new RangeError(`Archive authentication tags must contain ${GCM_TAG_BYTES} bytes.`);
  }
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(additionalAuthenticatedData);
  decipher.setAuthTag(authenticationTag);
  return decipher;
}
