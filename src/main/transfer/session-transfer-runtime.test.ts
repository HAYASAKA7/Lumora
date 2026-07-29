import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';


import { createSessionTransferRuntime } from './session-transfer-runtime';

describe('session transfer runtime', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'lumora-transfer-runtime-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('removes only Lumora-owned stale staging directories', async () => {
    const userData = join(root, 'user-data');
    const stagingRoot = join(userData, 'session-transfer', 'staging');
    const outsideRoot = join(root, 'outside');
    const stale = join(stagingRoot, `transfer-${randomUUID()}`);
    const unrelated = join(stagingRoot, 'keep-me');
    const outside = join(outsideRoot, 'keep-me');
    await mkdir(stale, { recursive: true });
    await mkdir(unrelated, { recursive: true });
    await mkdir(outside, { recursive: true });

    const runtime = await createSessionTransferRuntime({
      databasePath: join(root, 'catalog.db'),
      appUserDataPath: userData
    });
    await runtime.recoverStaging();

    await expect(stat(stale)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(unrelated)).resolves.toBeDefined();
    await expect(stat(outside)).resolves.toBeDefined();
    await runtime.close();
  });

  it('does not follow a matching staging symlink', async () => {
    const userData = join(root, 'user-data');
    const stagingRoot = join(userData, 'session-transfer', 'staging');
    const outside = join(root, 'outside');
    const link = join(stagingRoot, `transfer-${randomUUID()}`);
    await mkdir(stagingRoot, { recursive: true });
    await mkdir(outside);
    await symlink(outside, link, 'junction');

    const runtime = await createSessionTransferRuntime({
      databasePath: join(root, 'catalog.db'),
      appUserDataPath: userData
    });
    await runtime.recoverStaging();

    await expect(stat(outside)).resolves.toBeDefined();
    await expect(stat(link)).resolves.toBeDefined();
    await runtime.close();
  });

  it('cancels one active operation by its public operation identity', async () => {
    const runtime = await createSessionTransferRuntime({
      databasePath: join(root, 'catalog.db'),
      appUserDataPath: join(root, 'user-data')
    });
    let operationId = '';
    let stagingDirectory = '';
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const operation = runtime.runOperation(async (context) => {
      operationId = context.operationId;
      stagingDirectory = context.stagingDirectory;
      markStarted();
      await new Promise<void>((resolve) => {
        context.signal.addEventListener('abort', () => resolve(), { once: true });
      });
      expect(context.signal.aborted).toBe(true);
    });

    await started;
    expect(runtime.cancelOperation(operationId)).toBe(true);
    await operation;
    expect(runtime.cancelOperation(operationId)).toBe(false);
    await expect(stat(stagingDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    await runtime.close();
  });

  it('composes one service with runtime-owned persistence and cleanup', async () => {
    const runtime = await createSessionTransferRuntime({
      databasePath: join(root, 'catalog.db'),
      appUserDataPath: join(root, 'user-data'),
      serviceDependencies: {
        platform: 'linux',
        adapters: {
          get: () => null,
          providers: () => [],
          capabilities: () => []
        },
        catalog: {
          getTransferSession: () => null,
          getTransferSessionProvider: () => null,
          hasNativeSession: () => false
        },
        activeSessions: () => ({ sessionIds: [], unresolvedScopes: [] }),
        scanProviders: async () => ({
          scannedAt: '2026-07-29T08:00:00.000Z',
          providers: []
        }),
        workspaceById: () => null,
        workspaceCandidates: async () => [],
        workspaceProbes: { isDirectory: async () => false },
        refreshCatalog: async () => undefined,
        freeDiskBytes: async () => 1024 * 1024 * 1024,
        clock: () => new Date('2026-07-29T08:00:00.000Z'),
        createToken: randomUUID,
        onProgress: () => undefined
      }
    });

    expect(runtime.service).not.toBeNull();
    expect(runtime.service?.getHistory()).toEqual([]);
    await runtime.close();
    expect(() => runtime.service?.getHistory()).toThrowError(
      'The transfer service is closed.'
    );
  });
  it('aborts active operations, waits for cleanup, and closes idempotently', async () => {
    const runtime = await createSessionTransferRuntime({
      databasePath: join(root, 'catalog.db'),
      appUserDataPath: join(root, 'user-data')
    });
    let stagingDirectory = '';
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const operation = runtime.runOperation(async (context) => {
      stagingDirectory = context.stagingDirectory;
      markStarted();
      await new Promise<void>((resolve) => {
        context.signal.addEventListener('abort', () => resolve(), { once: true });
      });
      expect(context.signal.aborted).toBe(true);
    });

    await started;
    await runtime.close();
    await operation;
    await runtime.close();
    await expect(stat(stagingDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(runtime.stagingRoot)).toEqual([]);
  });
});
