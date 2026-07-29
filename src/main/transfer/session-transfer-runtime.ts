import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, readdir, realpath, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

import { migrateCatalogDatabase } from '../storage/migrations';
import {
  SessionTransferService,
  type SessionTransferServiceDependencies
} from './session-transfer-service';
import { TransferRepository } from './transfer-repository';

const OWNED_STAGING_PATTERN = /^transfer-[0-9a-f-]{36}$/i;

type RuntimeServiceDependencies = Omit<
  SessionTransferServiceDependencies,
  'stagingRoot' | 'runOperation' | 'cancelOperation' | 'history'
>;

export interface SessionTransferOperationContext {
  operationId: string;
  stagingDirectory: string;
  signal: AbortSignal;
}

export interface SessionTransferRuntime {
  readonly repository: TransferRepository;
  readonly service: SessionTransferService | null;
  readonly stagingRoot: string;
  recoverStaging(): Promise<void>;
  runOperation<T>(
    work: (context: SessionTransferOperationContext) => Promise<T>
  ): Promise<T>;
  cancelOperation(operationId: string): boolean;
  close(): Promise<void>;
}

interface ActiveOperation {
  controller: AbortController;
  promise: Promise<unknown>;
}

export interface CreateSessionTransferRuntimeOptions {
  databasePath: string;
  appUserDataPath: string;
  serviceDependencies?: RuntimeServiceDependencies;
}

function remainsInside(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot);
}

export async function createSessionTransferRuntime({
  databasePath,
  appUserDataPath,
  serviceDependencies
}: CreateSessionTransferRuntimeOptions): Promise<SessionTransferRuntime> {
  const database = new DatabaseSync(databasePath);
  try {
    migrateCatalogDatabase(database);
  } catch (error) {
    database.close();
    throw error;
  }

  const repository = new TransferRepository(database);
  const stagingRoot = join(appUserDataPath, 'session-transfer', 'staging');
  try {
    await mkdir(stagingRoot, { recursive: true });
  } catch (error) {
    database.close();
    throw error;
  }
  const active = new Map<string, ActiveOperation>();
  let closed = false;
  let closePromise: Promise<void> | null = null;

  const recoverStaging = async (): Promise<void> => {
    const resolvedRoot = await realpath(stagingRoot);
    const entries = await readdir(stagingRoot, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        if (
          !entry.isDirectory() ||
          !OWNED_STAGING_PATTERN.test(entry.name) ||
          active.has(entry.name.slice('transfer-'.length))
        ) {
          return;
        }
        const candidate = join(stagingRoot, entry.name);
        let resolvedCandidate: string;
        try {
          resolvedCandidate = await realpath(candidate);
        } catch {
          return;
        }
        if (!remainsInside(resolvedRoot, resolvedCandidate)) return;
        await rm(candidate, { recursive: true, force: true });
      })
    );
  };

  const runOperation = <T>(
    work: (context: SessionTransferOperationContext) => Promise<T>
  ): Promise<T> => {
    if (closed) {
      return Promise.reject(new Error('Session transfer runtime is closed.'));
    }
    const operationId = randomUUID();
    const stagingDirectory = join(stagingRoot, `transfer-${operationId}`);
    const controller = new AbortController();
    const promise = (async () => {
      try {
        await mkdir(stagingDirectory);
        if (controller.signal.aborted) {
          const error = new Error('The session transfer was cancelled.');
          error.name = 'AbortError';
          throw error;
        }
        return await work({
          operationId,
          stagingDirectory,
          signal: controller.signal
        });
      } finally {
        await rm(stagingDirectory, { recursive: true, force: true });
        active.delete(operationId);
      }
    })();
    active.set(operationId, { controller, promise });
    return promise;
  };

  const cancelOperation = (operationId: string): boolean => {
    const operation = active.get(operationId);
    if (operation === undefined) return false;
    operation.controller.abort();
    return true;
  };

  const service =
    serviceDependencies === undefined
      ? null
      : new SessionTransferService({
          ...serviceDependencies,
          stagingRoot,
          runOperation,
          cancelOperation,
          history: repository
        });

  const runtime: SessionTransferRuntime = {
    repository,
    service,
    stagingRoot,
    recoverStaging,
    runOperation,
    cancelOperation,
    close(): Promise<void> {
      closePromise ??= (async () => {
        closed = true;
        for (const operation of active.values()) operation.controller.abort();
        await Promise.allSettled(
          [...active.values()].map((operation) => operation.promise)
        );
        await service?.dispose();
        database.close();
      })();
      return closePromise;
    }
  };

  try {
    await runtime.recoverStaging();
  } catch (error) {
    await runtime.close();
    throw error;
  }
  return runtime;
}
