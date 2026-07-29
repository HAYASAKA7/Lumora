import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { describe, expect, it } from 'vitest';

import {
  createArchiveCipher,
  createArchiveDecipher,
  createEncryptionMaterial,
  deriveArchiveKey
} from './archive-crypto';

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

describe('archive crypto', () => {
  it('encrypts and decrypts streams split into one-byte chunks', async () => {
    const material = createEncryptionMaterial();
    const key = await deriveArchiveKey('correct horse battery staple', material.salt);
    const cipher = createArchiveCipher(key, material.nonce, Buffer.from('header'));
    const encryptedPromise = collect(cipher);
    await pipeline(Readable.from([...Buffer.from('portable session')].map((byte) => Buffer.from([byte]))), cipher);
    const encrypted = await encryptedPromise;
    const tag = cipher.getAuthTag();

    const decipher = createArchiveDecipher(key, material.nonce, Buffer.from('header'), tag);
    const decryptedPromise = collect(decipher);
    await pipeline(Readable.from([...encrypted].map((byte) => Buffer.from([byte]))), decipher);

    expect((await decryptedPromise).toString()).toBe('portable session');
    key.fill(0);
  });

  it('uses unique salts and nonces', () => {
    const first = createEncryptionMaterial();
    const second = createEncryptionMaterial();
    expect(first.salt.equals(second.salt)).toBe(false);
    expect(first.nonce.equals(second.nonce)).toBe(false);
  });

  it('rejects a wrong password', async () => {
    const material = createEncryptionMaterial();
    const goodKey = await deriveArchiveKey('right', material.salt);
    const wrongKey = await deriveArchiveKey('wrong', material.salt);
    const cipher = createArchiveCipher(goodKey, material.nonce, Buffer.from('header'));
    const encrypted = Buffer.concat([cipher.update('secret'), cipher.final()]);
    const decipher = createArchiveDecipher(
      wrongKey,
      material.nonce,
      Buffer.from('header'),
      cipher.getAuthTag()
    );
    expect(() => Buffer.concat([decipher.update(encrypted), decipher.final()])).toThrow();
    goodKey.fill(0);
    wrongKey.fill(0);
  });
});
