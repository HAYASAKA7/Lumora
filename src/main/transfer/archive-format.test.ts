import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  inspectArchiveEnvelope,
  openSessionArchive,
  writeSessionArchive
} from './archive-format';


const manifest = {
  formatVersion: 1,
  createdAt: '2026-07-29T00:00:00.000Z',
  sourcePlatform: 'win32',
  sessions: [
    {
      provider: 'opencode',
      nativeSessionId: 'ses_test',
      entryName: 'providers/opencode/session.json'
    }
  ]
} as const;

describe('session archive format', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'lumora-transfer-format-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('round trips an encrypted multi-entry archive through tiny chunks', async () => {
    const output = join(root, 'sessions.lumora-sessions');
    const payload = 'portable OpenCode session';
    await writeSessionArchive({
      outputPath: output,
      protection: { encrypted: true, password: 'correct horse battery staple' },
      manifest,
      entries: [
        {
          name: 'providers/opencode/session.json',
          body: Buffer.from(payload),
          chunkSize: 1
        }
      ]
    });

    const envelope = await inspectArchiveEnvelope(output);
    expect(envelope).toMatchObject({ version: 1, encrypted: true });
    const opened = await openSessionArchive({
      archivePath: output,
      password: 'correct horse battery staple',
      stagingDirectory: join(root, 'staging')
    });

    expect(opened.manifest).toEqual(manifest);
    expect(await readFile(opened.entries[0]!.stagedPath, 'utf8')).toBe(payload);
  });

  it('round trips an explicitly unencrypted archive', async () => {
    const output = join(root, 'plain.lumora-sessions');
    await writeSessionArchive({
      outputPath: output,
      protection: { encrypted: false },
      manifest,
      entries: [{ name: 'providers/opencode/session.json', body: '{}' }]
    });
    const opened = await openSessionArchive({
      archivePath: output,
      stagingDirectory: join(root, 'plain-staging')
    });
    expect(opened.manifest).toEqual(manifest);
  });

  it('rejects tampering before returning manifest details', async () => {
    const output = join(root, 'tampered.lumora-sessions');
    await writeSessionArchive({
      outputPath: output,
      protection: { encrypted: true, password: 'secret' },
      manifest,
      entries: [{ name: 'providers/opencode/session.json', body: '{}' }]
    });
    const bytes = await readFile(output);
    bytes[Math.floor(bytes.length / 2)]! ^= 0xff;
    await writeFile(output, bytes);

    await expect(
      openSessionArchive({
        archivePath: output,
        password: 'secret',
        stagingDirectory: join(root, 'tampered-staging')
      })
    ).rejects.toMatchObject({ code: 'ARCHIVE_AUTHENTICATION_FAILED' });
  });

  it('rejects a wrong password without leaving plaintext staging', async () => {
    const output = join(root, 'wrong-password.lumora-sessions');
    const staging = join(root, 'wrong-password-staging');
    await writeSessionArchive({
      outputPath: output,
      protection: { encrypted: true, password: 'right' },
      manifest,
      entries: [{ name: 'providers/opencode/session.json', body: 'secret' }]
    });

    await expect(
      openSessionArchive({
        archivePath: output,
        password: 'wrong',
        stagingDirectory: staging
      })
    ).rejects.toMatchObject({ code: 'ARCHIVE_AUTHENTICATION_FAILED' });
    await expect(readFile(join(staging, 'providers/opencode/session.json'))).rejects.toMatchObject({
      code: 'ENOENT'
    });
  });

  it('rejects payloads above the compression-ratio limit', async () => {
    const output = join(root, 'compression-bomb.lumora-sessions');
    await writeSessionArchive({
      outputPath: output,
      protection: { encrypted: false },
      manifest,
      entries: [
        {
          name: 'providers/opencode/session.json',
          body: Buffer.alloc(2 * 1024 * 1024)
        }
      ]
    });

    await expect(
      openSessionArchive({
        archivePath: output,
        stagingDirectory: join(root, 'compression-staging')
      })
    ).rejects.toMatchObject({ code: 'ARCHIVE_COMPRESSION_LIMIT' });
  });
  it('rejects traversal and duplicate normalized entry names', async () => {
    await expect(
      writeSessionArchive({
        outputPath: join(root, 'traversal.lumora-sessions'),
        protection: { encrypted: false },
        manifest,
        entries: [{ name: '../secret', body: 'x' }]
      })
    ).rejects.toThrow();
    await expect(
      writeSessionArchive({
        outputPath: join(root, 'duplicate.lumora-sessions'),
        protection: { encrypted: false },
        manifest,
        entries: [
          { name: 'provider/session.json', body: 'a' },
          { name: 'provider/session.json', body: 'b' }
        ]
      })
    ).rejects.toMatchObject({ code: 'ARCHIVE_DUPLICATE_ENTRY' });
  });

  it('rejects a declared-size mismatch', async () => {
    await expect(
      writeSessionArchive({
        outputPath: join(root, 'size.lumora-sessions'),
        protection: { encrypted: false },
        manifest,
        entries: [
          {
            name: 'providers/opencode/session.json',
            body: 'short',
            declaredSize: 100
          }
        ]
      })
    ).rejects.toMatchObject({ code: 'ARCHIVE_SIZE_MISMATCH' });
  });

  it('never deletes or reuses a caller-owned staging directory', async () => {
    const output = join(root, 'existing-staging.lumora-sessions');
    const staging = join(root, 'existing-staging');
    const sentinel = join(staging, 'keep.txt');
    await writeSessionArchive({
      outputPath: output,
      protection: { encrypted: false },
      manifest,
      entries: [{ name: 'providers/opencode/session.json', body: '{}' }]
    });
    await mkdir(staging);
    await writeFile(sentinel, 'keep');

    await expect(
      openSessionArchive({ archivePath: output, stagingDirectory: staging })
    ).rejects.toMatchObject({ code: 'ARCHIVE_STAGING_EXISTS' });
    expect(await readFile(sentinel, 'utf8')).toBe('keep');
  });
  it('honors cancellation without leaving a final archive', async () => {
    const output = join(root, 'cancelled.lumora-sessions');
    const controller = new AbortController();
    controller.abort();
    await expect(
      writeSessionArchive({
        outputPath: output,
        protection: { encrypted: false },
        manifest,
        entries: [{ name: 'providers/opencode/session.json', body: '{}' }],
        signal: controller.signal
      })
    ).rejects.toMatchObject({ name: 'AbortError' });
    await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
