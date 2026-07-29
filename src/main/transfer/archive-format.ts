import { createHash, randomUUID } from 'node:crypto';
import {
  appendFile,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';

import type { TransferProtection } from '../../shared/session-transfer';
import {
  createArchiveCipher,
  createArchiveDecipher,
  createEncryptionMaterial,
  deriveArchiveKey,
  GCM_TAG_BYTES,
  SCRYPT_OPTIONS
} from './archive-crypto';
import {
  assertContainedPath,
  assertRegularFile,
  assertSafeArchiveEntryName
} from './transfer-path-safety';

export const ARCHIVE_MAGIC = Buffer.from('LUMORA\u0000\u0001', 'binary');
export const ARCHIVE_VERSION = 1;
export const MAX_ARCHIVE_ENTRIES = 25_000;
export const MAX_DECOMPRESSED_BYTES = 32 * 1024 * 1024 * 1024;
export const MAX_COMPRESSION_RATIO = 200;
const MAX_HEADER_BYTES = 64 * 1024;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_ENTRY_METADATA_BYTES = 64 * 1024;
const HEADER_PREFIX_BYTES = ARCHIVE_MAGIC.length + 4;

export class ArchiveFormatError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ArchiveFormatError';
  }
}

export interface SessionArchiveManifest {
  formatVersion: 1;
  createdAt: string;
  sourcePlatform: 'win32' | 'darwin' | 'linux';
  sessions: readonly Record<string, unknown>[];
  [key: string]: unknown;
}

export interface ArchiveEntryInput {
  name: string;
  body?: string | Buffer | Uint8Array | NodeJS.ReadableStream;
  sourcePath?: string;
  declaredSize?: number;
  chunkSize?: number;
}

export interface WriteArchiveInput {
  outputPath: string;
  protection: TransferProtection;
  manifest: SessionArchiveManifest;
  entries: Iterable<ArchiveEntryInput> | AsyncIterable<ArchiveEntryInput>;
  signal?: AbortSignal;
}

export interface ArchiveWriteResult {
  entryCount: number;
  archiveBytes: number;
  encrypted: boolean;
}

export interface ArchiveEnvelope {
  version: 1;
  encrypted: boolean;
  salt: string | null;
  nonce: string | null;
  kdf: typeof SCRYPT_OPTIONS | null;
  compression: 'gzip';
  ciphertextLength: number;
  headerBytes: Buffer;
  payloadOffset: number;
}

export interface OpenArchiveInput {
  archivePath: string;
  password?: string;
  stagingDirectory: string;
  signal?: AbortSignal;
}

export interface OpenedArchiveEntry {
  name: string;
  size: number;
  sha256: string;
  stagedPath: string;
}

export interface OpenedArchive {
  manifest: SessionArchiveManifest;
  entries: OpenedArchiveEntry[];
  envelope: ArchiveEnvelope;
}

interface EntryMetadata {
  name: string;
  sha256: string;
}

function abortError(): Error {
  const error = new Error('The session transfer was cancelled.');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function uint32(value: number): Buffer {
  const output = Buffer.allocUnsafe(4);
  output.writeUInt32BE(value);
  return output;
}

function uint64(value: number): Buffer {
  const output = Buffer.allocUnsafe(8);
  output.writeBigUInt64BE(BigInt(value));
  return output;
}

function asReadable(entry: ArchiveEntryInput): NodeJS.ReadableStream {
  if (entry.sourcePath !== undefined) return createReadStream(entry.sourcePath);
  if (entry.body === undefined) {
    throw new ArchiveFormatError('ARCHIVE_SOURCE_MISSING', 'Archive entry has no source.');
  }
  if (typeof entry.body === 'string' || Buffer.isBuffer(entry.body) || entry.body instanceof Uint8Array) {
    const value = Buffer.from(entry.body);
    const chunkSize = entry.chunkSize ?? Math.max(1, value.length);
    return Readable.from(
      Array.from({ length: Math.ceil(value.length / chunkSize) }, (_, index) =>
        value.subarray(index * chunkSize, (index + 1) * chunkSize)
      )
    );
  }
  return entry.body;
}

async function materializeEntry(
  entry: ArchiveEntryInput,
  tempPath: string,
  signal?: AbortSignal
): Promise<{ size: number; sha256: string }> {
  if (entry.sourcePath !== undefined) await assertRegularFile(entry.sourcePath);
  const hash = createHash('sha256');
  let size = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > MAX_DECOMPRESSED_BYTES) {
        callback(
          new ArchiveFormatError(
            'ARCHIVE_DECOMPRESSED_LIMIT',
            'Archive content exceeds the decompressed size limit.'
          )
        );
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    }
  });
  await pipeline(asReadable(entry), meter, createWriteStream(tempPath, { flags: 'wx' }), {
    signal
  });
  if (entry.declaredSize !== undefined && entry.declaredSize !== size) {
    throw new ArchiveFormatError(
      'ARCHIVE_SIZE_MISMATCH',
      'Archive entry size does not match its declaration.'
    );
  }
  return { size, sha256: hash.digest('hex') };
}

async function buildPrivatePayload(
  input: WriteArchiveInput,
  rawPath: string,
  entryTempRoot: string
): Promise<{ entryCount: number; decompressedBytes: number }> {
  throwIfAborted(input.signal);
  const manifestBytes = Buffer.from(JSON.stringify(input.manifest), 'utf8');
  if (manifestBytes.length > MAX_MANIFEST_BYTES) {
    throw new ArchiveFormatError('ARCHIVE_MANIFEST_LIMIT', 'Archive manifest is too large.');
  }
  const raw = await open(rawPath, 'wx');
  const names = new Set<string>();
  let entryCount = 0;
  let decompressedBytes = 4 + manifestBytes.length;
  try {
    await raw.write(uint32(manifestBytes.length));
    await raw.write(manifestBytes);
    for await (const entry of input.entries) {
      throwIfAborted(input.signal);
      entryCount += 1;
      if (entryCount > MAX_ARCHIVE_ENTRIES) {
        throw new ArchiveFormatError(
          'ARCHIVE_ENTRY_LIMIT',
          'Archive contains too many entries.'
        );
      }
      const name = assertSafeArchiveEntryName(entry.name);
      if (names.has(name)) {
        throw new ArchiveFormatError(
          'ARCHIVE_DUPLICATE_ENTRY',
          'Archive contains a duplicate entry.'
        );
      }
      names.add(name);
      const materializedPath = join(entryTempRoot, `${entryCount}-${randomUUID()}`);
      try {
        const materialized = await materializeEntry(entry, materializedPath, input.signal);
        const metadata: EntryMetadata = { name, sha256: materialized.sha256 };
        const metadataBytes = Buffer.from(JSON.stringify(metadata), 'utf8');
        if (metadataBytes.length > MAX_ENTRY_METADATA_BYTES) {
          throw new ArchiveFormatError(
            'ARCHIVE_METADATA_LIMIT',
            'Archive entry metadata is too large.'
          );
        }
        decompressedBytes += 4 + metadataBytes.length + 8 + materialized.size;
        if (decompressedBytes > MAX_DECOMPRESSED_BYTES) {
          throw new ArchiveFormatError(
            'ARCHIVE_DECOMPRESSED_LIMIT',
            'Archive content exceeds the decompressed size limit.'
          );
        }
        await raw.write(uint32(metadataBytes.length));
        await raw.write(metadataBytes);
        await raw.write(uint64(materialized.size));
        await new Promise<void>((resolve, reject) => {
          const source = createReadStream(materializedPath);
          source.on('data', (chunk) => {
            source.pause();
            raw.write(chunk as Buffer).then(() => source.resume(), reject);
          });
          source.once('end', resolve);
          source.once('error', reject);
        });
      } finally {
        await rm(materializedPath, { force: true });
      }
    }
  } finally {
    await raw.close();
  }
  return { entryCount, decompressedBytes };
}

function serializeHeader(input: Omit<ArchiveEnvelope, 'headerBytes' | 'payloadOffset'>): Buffer {
  const bytes = Buffer.from(JSON.stringify(input), 'utf8');
  if (bytes.length > MAX_HEADER_BYTES) {
    throw new ArchiveFormatError('ARCHIVE_HEADER_LIMIT', 'Archive header is too large.');
  }
  return bytes;
}

async function writeEnvelope(
  input: WriteArchiveInput,
  compressedPath: string,
  partialPath: string
): Promise<void> {
  const compressed = await stat(compressedPath);
  const material = input.protection.encrypted ? createEncryptionMaterial() : null;
  const header = {
    version: 1 as const,
    encrypted: input.protection.encrypted,
    salt: material?.salt.toString('hex') ?? null,
    nonce: material?.nonce.toString('hex') ?? null,
    kdf: material ? SCRYPT_OPTIONS : null,
    compression: 'gzip' as const,
    ciphertextLength: compressed.size
  };
  const headerBytes = serializeHeader(header);
  await writeFile(partialPath, Buffer.concat([ARCHIVE_MAGIC, uint32(headerBytes.length), headerBytes]), {
    flag: 'wx'
  });
  if (!input.protection.encrypted || material === null) {
    await pipeline(createReadStream(compressedPath), createWriteStream(partialPath, { flags: 'a' }), {
      signal: input.signal
    });
    return;
  }
  const key = await deriveArchiveKey(input.protection.password, material.salt);
  try {
    const cipher = createArchiveCipher(key, material.nonce, headerBytes);
    await pipeline(
      createReadStream(compressedPath),
      cipher,
      createWriteStream(partialPath, { flags: 'a' }),
      { signal: input.signal }
    );
    await appendFile(partialPath, cipher.getAuthTag());
  } finally {
    key.fill(0);
  }
}

export async function writeSessionArchive(input: WriteArchiveInput): Promise<ArchiveWriteResult> {
  throwIfAborted(input.signal);
  await mkdir(dirname(input.outputPath), { recursive: true });
  const suffix = `.partial-${randomUUID()}`;
  const rawPath = `${input.outputPath}${suffix}.raw`;
  const compressedPath = `${input.outputPath}${suffix}.gz`;
  const partialPath = `${input.outputPath}${suffix}`;
  const entryTempRoot = `${input.outputPath}${suffix}.entries`;
  await mkdir(entryTempRoot, { recursive: true });
  try {
    const built = await buildPrivatePayload(input, rawPath, entryTempRoot);
    await pipeline(createReadStream(rawPath), createGzip(), createWriteStream(compressedPath, { flags: 'wx' }), {
      signal: input.signal
    });
    await writeEnvelope(input, compressedPath, partialPath);
    throwIfAborted(input.signal);
    await rename(partialPath, input.outputPath);
    const output = await stat(input.outputPath);
    return {
      entryCount: built.entryCount,
      archiveBytes: output.size,
      encrypted: input.protection.encrypted
    };
  } finally {
    await Promise.all([
      rm(rawPath, { force: true }),
      rm(compressedPath, { force: true }),
      rm(partialPath, { force: true }),
      rm(entryTempRoot, { recursive: true, force: true })
    ]);
  }
}

function parseEnvelope(value: unknown, headerBytes: Buffer): ArchiveEnvelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ArchiveFormatError('ARCHIVE_HEADER_INVALID', 'Archive header is invalid.');
  }
  const header = value as Record<string, unknown>;
  const allowed = ['version', 'encrypted', 'salt', 'nonce', 'kdf', 'compression', 'ciphertextLength'];
  if (Object.keys(header).some((key) => !allowed.includes(key))) {
    throw new ArchiveFormatError('ARCHIVE_HEADER_INVALID', 'Archive header is invalid.');
  }
  if (
    header.version !== ARCHIVE_VERSION ||
    typeof header.encrypted !== 'boolean' ||
    header.compression !== 'gzip' ||
    typeof header.ciphertextLength !== 'number' ||
    !Number.isSafeInteger(header.ciphertextLength) ||
    header.ciphertextLength < 0
  ) {
    throw new ArchiveFormatError('ARCHIVE_HEADER_INVALID', 'Archive header is invalid.');
  }
  if (header.encrypted) {
    if (
      typeof header.salt !== 'string' ||
      !/^[a-f0-9]{32}$/.test(header.salt) ||
      typeof header.nonce !== 'string' ||
      !/^[a-f0-9]{24}$/.test(header.nonce) ||
      JSON.stringify(header.kdf) !== JSON.stringify(SCRYPT_OPTIONS)
    ) {
      throw new ArchiveFormatError('ARCHIVE_HEADER_INVALID', 'Archive encryption header is invalid.');
    }
  } else if (header.salt !== null || header.nonce !== null || header.kdf !== null) {
    throw new ArchiveFormatError('ARCHIVE_HEADER_INVALID', 'Unencrypted archive header is invalid.');
  }
  return {
    version: 1 as const,
    encrypted: header.encrypted,
    salt: header.salt as string | null,
    nonce: header.nonce as string | null,
    kdf: header.encrypted ? SCRYPT_OPTIONS : null,
    compression: 'gzip',
    ciphertextLength: header.ciphertextLength,
    headerBytes,
    payloadOffset: HEADER_PREFIX_BYTES + headerBytes.length
  };
}

export async function inspectArchiveEnvelope(path: string): Promise<ArchiveEnvelope> {
  await assertRegularFile(path);
  const handle = await open(path, 'r');
  try {
    const prefix = await readExact(handle, HEADER_PREFIX_BYTES, 0);
    if (!prefix.subarray(0, ARCHIVE_MAGIC.length).equals(ARCHIVE_MAGIC)) {
      throw new ArchiveFormatError(
        'ARCHIVE_MAGIC_INVALID',
        'File is not a Lumora session archive.'
      );
    }
    const headerLength = prefix.readUInt32BE(ARCHIVE_MAGIC.length);
    if (headerLength < 2 || headerLength > MAX_HEADER_BYTES) {
      throw new ArchiveFormatError('ARCHIVE_HEADER_LIMIT', 'Archive header length is invalid.');
    }
    const headerBytes = await readExact(
      handle,
      headerLength,
      HEADER_PREFIX_BYTES
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(headerBytes.toString('utf8'));
    } catch {
      throw new ArchiveFormatError('ARCHIVE_HEADER_INVALID', 'Archive header is invalid.');
    }
    const envelope = parseEnvelope(parsed, headerBytes);
    const archive = await handle.stat();
    const expected = envelope.payloadOffset + envelope.ciphertextLength + (envelope.encrypted ? GCM_TAG_BYTES : 0);
    if (archive.size !== expected) {
      throw new ArchiveFormatError('ARCHIVE_SIZE_MISMATCH', 'Archive size does not match its header.');
    }
    return envelope;
  } finally {
    await handle.close();
  }
}

async function authenticatePayload(
  input: OpenArchiveInput,
  envelope: ArchiveEnvelope,
  compressedPath: string
): Promise<void> {
  const payloadEnd = envelope.payloadOffset + envelope.ciphertextLength - 1;
  if (!envelope.encrypted) {
    await pipeline(
      createReadStream(input.archivePath, { start: envelope.payloadOffset, end: payloadEnd }),
      createWriteStream(compressedPath, { flags: 'wx' }),
      { signal: input.signal }
    );
    return;
  }
  if (!input.password || envelope.salt === null || envelope.nonce === null) {
    throw new ArchiveFormatError('ARCHIVE_PASSWORD_REQUIRED', 'Archive password is required.');
  }
  const handle = await open(input.archivePath, 'r');
  let tag: Buffer;
  try {
    tag = await readExact(handle, GCM_TAG_BYTES, payloadEnd + 1);
  } finally {
    await handle.close();
  }
  const key = await deriveArchiveKey(input.password, Buffer.from(envelope.salt, 'hex'));
  try {
    const decipher = createArchiveDecipher(
      key,
      Buffer.from(envelope.nonce, 'hex'),
      envelope.headerBytes,
      tag
    );
    try {
      await pipeline(
        createReadStream(input.archivePath, { start: envelope.payloadOffset, end: payloadEnd }),
        decipher,
        createWriteStream(compressedPath, { flags: 'wx' }),
        { signal: input.signal }
      );
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw error;
      throw new ArchiveFormatError(
        'ARCHIVE_AUTHENTICATION_FAILED',
        'Archive password is incorrect or the archive was modified.'
      );
    }
  } finally {
    key.fill(0);
  }
}

async function decompressPayload(
  compressedPath: string,
  rawPath: string,
  compressedBytes: number,
  signal?: AbortSignal
): Promise<void> {
  let decompressed = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      decompressed += chunk.length;
      if (
        decompressed > MAX_DECOMPRESSED_BYTES ||
        (compressedBytes > 0 && decompressed > compressedBytes * MAX_COMPRESSION_RATIO)
      ) {
        callback(
          new ArchiveFormatError(
            'ARCHIVE_COMPRESSION_LIMIT',
            'Archive exceeds decompression safety limits.'
          )
        );
        return;
      }
      callback(null, chunk);
    }
  });
  await pipeline(
    createReadStream(compressedPath),
    createGunzip(),
    meter,
    createWriteStream(rawPath, { flags: 'wx' }),
    { signal }
  );
}

async function readExact(
  handle: Awaited<ReturnType<typeof open>>,
  length: number,
  position: number
): Promise<Buffer> {
  const bytes = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const result = await handle.read(
      bytes,
      offset,
      length - offset,
      position + offset
    );
    if (result.bytesRead === 0) {
      throw new ArchiveFormatError(
        'ARCHIVE_TRUNCATED',
        'Archive payload is truncated.'
      );
    }
    offset += result.bytesRead;
  }
  return bytes;
}

function parseManifest(bytes: Buffer): SessionArchiveManifest {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new ArchiveFormatError('ARCHIVE_MANIFEST_INVALID', 'Archive manifest is invalid.');
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    (value as Record<string, unknown>).formatVersion !== ARCHIVE_VERSION ||
    typeof (value as Record<string, unknown>).createdAt !== 'string' ||
    !['win32', 'darwin', 'linux'].includes(String((value as Record<string, unknown>).sourcePlatform)) ||
    !Array.isArray((value as Record<string, unknown>).sessions)
  ) {
    throw new ArchiveFormatError('ARCHIVE_MANIFEST_INVALID', 'Archive manifest is invalid.');
  }
  return value as SessionArchiveManifest;
}

async function parsePrivatePayload(
  rawPath: string,
  stagingDirectory: string,
  signal?: AbortSignal
): Promise<{ manifest: SessionArchiveManifest; entries: OpenedArchiveEntry[] }> {
  await mkdir(stagingDirectory, { recursive: true });
  assertContainedPath(stagingDirectory, 'safety-check');
  const handle = await open(rawPath, 'r');
  const rawStatus = await handle.stat();
  let position = 0;
  let totalContent = 0;
  const names = new Set<string>();
  const entries: OpenedArchiveEntry[] = [];
  try {
    const manifestLengthBytes = await readExact(handle, 4, position);
    position += 4;
    const manifestLength = manifestLengthBytes.readUInt32BE(0);
    if (manifestLength > MAX_MANIFEST_BYTES) {
      throw new ArchiveFormatError('ARCHIVE_MANIFEST_LIMIT', 'Archive manifest is too large.');
    }
    const manifest = parseManifest(await readExact(handle, manifestLength, position));
    position += manifestLength;
    while (position < rawStatus.size) {
      throwIfAborted(signal);
      if (entries.length >= MAX_ARCHIVE_ENTRIES) {
        throw new ArchiveFormatError('ARCHIVE_ENTRY_LIMIT', 'Archive contains too many entries.');
      }
      const metadataLength = (await readExact(handle, 4, position)).readUInt32BE(0);
      position += 4;
      if (metadataLength < 2 || metadataLength > MAX_ENTRY_METADATA_BYTES) {
        throw new ArchiveFormatError('ARCHIVE_METADATA_LIMIT', 'Archive entry metadata is invalid.');
      }
      const metadataBytes = await readExact(handle, metadataLength, position);
      position += metadataLength;
      let metadata: EntryMetadata;
      try {
        const value = JSON.parse(metadataBytes.toString('utf8')) as Record<string, unknown>;
        if (
          Object.keys(value).length !== 2 ||
          typeof value.name !== 'string' ||
          typeof value.sha256 !== 'string' ||
          !/^[a-f0-9]{64}$/.test(value.sha256)
        ) {
          throw new Error('invalid');
        }
        metadata = { name: assertSafeArchiveEntryName(value.name), sha256: value.sha256 };
      } catch (error) {
        if (error instanceof ArchiveFormatError) throw error;
        throw new ArchiveFormatError('ARCHIVE_METADATA_INVALID', 'Archive entry metadata is invalid.');
      }
      if (names.has(metadata.name)) {
        throw new ArchiveFormatError('ARCHIVE_DUPLICATE_ENTRY', 'Archive contains a duplicate entry.');
      }
      names.add(metadata.name);
      const lengthValue = (await readExact(handle, 8, position)).readBigUInt64BE(0);
      position += 8;
      if (lengthValue > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new ArchiveFormatError('ARCHIVE_DECOMPRESSED_LIMIT', 'Archive entry is too large.');
      }
      const contentLength = Number(lengthValue);
      totalContent += contentLength;
      if (totalContent > MAX_DECOMPRESSED_BYTES || position + contentLength > rawStatus.size) {
        throw new ArchiveFormatError('ARCHIVE_DECOMPRESSED_LIMIT', 'Archive content exceeds safety limits.');
      }
      const stagedPath = assertContainedPath(stagingDirectory, metadata.name);
      await mkdir(dirname(stagedPath), { recursive: true });
      const hash = createHash('sha256');
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          hash.update(chunk);
          callback(null, chunk);
        }
      });
      if (contentLength === 0) {
        await writeFile(stagedPath, Buffer.alloc(0), { flag: 'wx' });
      } else {
        await pipeline(
          createReadStream(rawPath, { start: position, end: position + contentLength - 1 }),
          meter,
          createWriteStream(stagedPath, { flags: 'wx' }),
          { signal }
        );
      }
      const checksum = contentLength === 0 ? createHash('sha256').digest('hex') : hash.digest('hex');
      if (checksum !== metadata.sha256) {
        throw new ArchiveFormatError('ARCHIVE_CHECKSUM_FAILED', 'Archive entry checksum failed.');
      }
      entries.push({
        name: metadata.name,
        size: contentLength,
        sha256: metadata.sha256,
        stagedPath
      });
      position += contentLength;
    }
    return { manifest, entries };
  } finally {
    await handle.close();
  }
}

export async function openSessionArchive(input: OpenArchiveInput): Promise<OpenedArchive> {
  throwIfAborted(input.signal);
  const envelope = await inspectArchiveEnvelope(input.archivePath);
  try {
    await mkdir(input.stagingDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new ArchiveFormatError(
        'ARCHIVE_STAGING_EXISTS',
        'Archive staging directory already exists.'
      );
    }
    throw error;
  }
  const workRoot = `${input.stagingDirectory}.opening-${randomUUID()}`;
  const compressedPath = join(workRoot, 'payload.gz');
  const rawPath = join(workRoot, 'payload.raw');
  try {
    await mkdir(workRoot);
    await authenticatePayload(input, envelope, compressedPath);
    await decompressPayload(compressedPath, rawPath, envelope.ciphertextLength, input.signal);
    const opened = await parsePrivatePayload(rawPath, input.stagingDirectory, input.signal);
    return { ...opened, envelope };
  } catch (error) {
    await rm(input.stagingDirectory, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
}
