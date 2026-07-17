import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { ProviderId } from '../../shared/contracts';
import type {
  CatalogSourceFingerprint,
  CatalogCandidate
} from '../catalog/catalog-candidate';
import type { StoredCatalogSource } from '../storage/catalog-repository';
import { isPortableAbsolutePath } from './session-discovery';
import {
  ProviderSessionRecordSchema,
  type ProviderSessionDiscoveryResult,
  type ProviderSessionRecord
} from './session-discovery';

export type JsonSessionProvider = 'gemini' | 'qwen';

interface FileStatLike {
  size: number;
  mtimeMs: number;
  isFile(): boolean;
}

type StatFile = (path: string) => Promise<FileStatLike>;
type LookupSource = (
  provider: ProviderId,
  sourceKey: string,
  fingerprint: CatalogSourceFingerprint
) => Promise<StoredCatalogSource | null>;

interface DiscoverJsonSessionsOptions {
  provider: JsonSessionProvider;
  storageRoot: string;
  lookupSource?: LookupSource;
  statFile?: StatFile;
  maxFiles?: number;
  maxBytes?: number;
}

interface SessionFile {
  sourcePath: string;
  projectRootPath: string;
}

export class JsonSessionSourceError extends Error {
  readonly code = 'JSON_SESSION_SOURCE_FAILED';

  constructor(message: string) {
    super(message);
    this.name = 'JsonSessionSourceError';
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

function fingerprintOf(value: FileStatLike): CatalogSourceFingerprint {
  return {
    size: Math.trunc(value.size),
    modifiedAtMs: Math.trunc(value.mtimeMs)
  };
}

function sameFingerprint(
  left: CatalogSourceFingerprint | null,
  right: CatalogSourceFingerprint
): boolean {
  return (
    left !== null &&
    left.size === right.size &&
    left.modifiedAtMs === right.modifiedAtMs
  );
}

async function enumerateSessionFiles(
  storageRoot: string,
  maxFiles: number
): Promise<{ files: SessionFile[]; skipped: number }> {
  let projects;
  try {
    projects = await readdir(storageRoot, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return { files: [], skipped: 0 };
    throw new JsonSessionSourceError(
      'Provider session storage could not be enumerated.'
    );
  }

  const files: SessionFile[] = [];
  let skipped = 0;
  for (const project of projects
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const projectPath = resolve(storageRoot, project.name);
    let chats;
    try {
      chats = await readdir(join(projectPath, 'chats'), {
        withFileTypes: true
      });
    } catch (error) {
      if (!isMissing(error)) skipped += 1;
      continue;
    }
    for (const chat of chats
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .sort((left, right) => left.name.localeCompare(right.name))) {
      if (files.length >= maxFiles) {
        skipped += 1;
        continue;
      }
      files.push({
        sourcePath: resolve(projectPath, 'chats', chat.name),
        projectRootPath: join(projectPath, '.project_root')
      });
    }
  }
  return { files, skipped };
}

function parsedTimestamp(value: unknown): number | null {
  const milliseconds =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Date.parse(value)
        : Number.NaN;
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function sessionTitle(value: Record<string, unknown>): string {
  for (const field of ['summary', 'title']) {
    const candidate = value[field];
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim().slice(0, 256);
    }
  }
  return 'Untitled session';
}

function normalizeJsonSession(
  provider: JsonSessionProvider,
  value: unknown,
  workspacePath: string,
  sourceKey: string,
  fingerprint: CatalogSourceFingerprint
): ProviderSessionRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.sessionId !== 'string' ||
    record.sessionId.trim().length === 0
  ) {
    return null;
  }

  const messageTimestamps = Array.isArray(record.messages)
    ? record.messages.flatMap((message) => {
        if (
          typeof message !== 'object' ||
          message === null ||
          Array.isArray(message)
        ) {
          return [];
        }
        const timestamp = parsedTimestamp(
          (message as Record<string, unknown>).timestamp
        );
        return timestamp === null ? [] : [timestamp];
      })
    : [];
  const updatedMilliseconds =
    messageTimestamps.length > 0
      ? Math.max(...messageTimestamps)
      : fingerprint.modifiedAtMs;
  const requestedCreated = parsedTimestamp(record.startTime);
  const createdMilliseconds =
    requestedCreated !== null && requestedCreated <= updatedMilliseconds
      ? requestedCreated
      : updatedMilliseconds;

  const parsed = ProviderSessionRecordSchema.safeParse({
    provider,
    nativeId: record.sessionId.trim(),
    workspacePath,
    title: sessionTitle(record),
    createdAt: new Date(createdMilliseconds).toISOString(),
    updatedAt: new Date(updatedMilliseconds).toISOString(),
    source: { key: sourceKey, fingerprint }
  });
  return parsed.success ? parsed.data : null;
}

function reuseStoredSource(
  provider: JsonSessionProvider,
  candidate: CatalogCandidate,
  sourceKey: string,
  fingerprint: CatalogSourceFingerprint
): ProviderSessionRecord | null {
  const parsed = ProviderSessionRecordSchema.safeParse({
    provider: candidate.provider,
    nativeId: candidate.nativeId,
    workspacePath: candidate.workspace.canonicalPath,
    title: candidate.title,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    source: { key: sourceKey, fingerprint }
  });
  return parsed.success && parsed.data.provider === provider ? parsed.data : null;
}

export async function discoverJsonSessions({
  provider,
  storageRoot,
  lookupSource = async () => null,
  statFile = stat,
  maxFiles = 25_000,
  maxBytes = 8 * 1024 * 1024
}: DiscoverJsonSessionsOptions): Promise<ProviderSessionDiscoveryResult> {
  const enumeration = await enumerateSessionFiles(
    resolve(storageRoot),
    Math.max(0, Math.trunc(maxFiles))
  );
  const sessions = new Map<string, ProviderSessionRecord>();
  let invalidCount = enumeration.skipped;
  let unchangedCount = 0;

  for (const file of enumeration.files) {
    try {
      const beforeStat = await statFile(file.sourcePath);
      const before = fingerprintOf(beforeStat);
      if (
        !beforeStat.isFile() ||
        before.size < 1 ||
        before.size > Math.max(1, Math.trunc(maxBytes))
      ) {
        invalidCount += 1;
        continue;
      }

      const stored = await lookupSource(provider, file.sourcePath, before);
      let normalized: ProviderSessionRecord | null;
      if (stored !== null && sameFingerprint(stored.fingerprint, before)) {
        normalized = reuseStoredSource(
          provider,
          stored.candidate,
          file.sourcePath,
          before
        );
        if (normalized !== null) unchangedCount += 1;
      } else {
        const projectRootStat = await statFile(file.projectRootPath);
        if (
          !projectRootStat.isFile() ||
          projectRootStat.size < 1 ||
          projectRootStat.size > 32_768
        ) {
          invalidCount += 1;
          continue;
        }
        const workspacePath = (
          await readFile(file.projectRootPath, 'utf8')
        ).trim();
        if (
          workspacePath.length === 0 ||
          workspacePath.length > 32_768 ||
          !isPortableAbsolutePath(workspacePath)
        ) {
          invalidCount += 1;
          continue;
        }
        const json = await readFile(file.sourcePath, 'utf8');
        const after = fingerprintOf(await statFile(file.sourcePath));
        if (!sameFingerprint(before, after)) {
          invalidCount += 1;
          continue;
        }
        let value: unknown;
        try {
          value = JSON.parse(json);
        } catch {
          invalidCount += 1;
          continue;
        }
        normalized = normalizeJsonSession(
          provider,
          value,
          workspacePath,
          file.sourcePath,
          before
        );
      }

      if (normalized === null) {
        invalidCount += 1;
        continue;
      }
      const existing = sessions.get(normalized.nativeId);
      if (
        existing === undefined ||
        normalized.updatedAt > existing.updatedAt ||
        (normalized.updatedAt === existing.updatedAt &&
          normalized.title > existing.title)
      ) {
        sessions.set(normalized.nativeId, normalized);
      }
    } catch {
      invalidCount += 1;
    }
  }

  const orderedSessions = [...sessions.values()].sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      left.nativeId.localeCompare(right.nativeId)
  );
  return {
    provider,
    sessions: orderedSessions,
    discoveredCount: orderedSessions.length,
    unchangedCount,
    invalidCount
  };
}
