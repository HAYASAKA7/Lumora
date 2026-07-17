import { open, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { ProviderId } from '../../shared/contracts';
import type { CatalogSourceFingerprint } from '../catalog/catalog-candidate';
import type { StoredCatalogSource } from '../storage/catalog-repository';
import { isPortableAbsolutePath } from './session-discovery';
import {
  ProviderSessionRecordSchema,
  type ProviderSessionDiscoveryResult,
  type ProviderSessionRecord
} from './session-discovery';

type Environment = Readonly<Record<string, string | undefined>>;

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

interface DiscoverCopilotOptions {
  homeDirectory: string;
  env: Environment;
  lookupSource?: LookupSource;
  statFile?: StatFile;
  maxFiles?: number;
  maxFileBytes?: number;
  prefixBytes?: number;
  tailBytes?: number;
}

interface MetadataSegments {
  lines: readonly string[];
  after: CatalogSourceFingerprint;
}

const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class CopilotSessionSourceError extends Error {
  readonly code = 'COPILOT_SESSION_SOURCE_FAILED';

  constructor(message: string) {
    super(message);
    this.name = 'CopilotSessionSourceError';
  }
}

function environmentValue(
  env: Environment,
  key: string
): string | undefined {
  const matching = Object.keys(env).find(
    (candidate) => candidate.toLocaleLowerCase() === key.toLocaleLowerCase()
  );
  return matching === undefined ? undefined : env[matching];
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

async function enumerateEventLogs(
  sessionStateRoot: string,
  maxFiles: number
): Promise<{ paths: string[]; skipped: number }> {
  let entries;
  try {
    entries = await readdir(sessionStateRoot, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return { paths: [], skipped: 0 };
    throw new CopilotSessionSourceError(
      'GitHub Copilot CLI session storage could not be enumerated.'
    );
  }

  const paths: string[] = [];
  let skipped = 0;
  for (const entry of entries
    .filter(
      (candidate) =>
        candidate.isDirectory() && SESSION_ID_PATTERN.test(candidate.name)
    )
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const eventPath = resolve(sessionStateRoot, entry.name, 'events.jsonl');
    try {
      const eventStat = await stat(eventPath);
      if (!eventStat.isFile()) continue;
    } catch (error) {
      if (isMissing(error)) continue;
      skipped += 1;
      continue;
    }
    if (paths.length >= maxFiles) {
      skipped += 1;
      continue;
    }
    paths.push(eventPath);
  }
  return { paths, skipped };
}

function completePrefix(text: string, reachesEnd: boolean): string {
  if (reachesEnd) return text;
  const newline = text.lastIndexOf('\n');
  return newline < 0 ? '' : text.slice(0, newline + 1);
}

function completeTail(
  text: string,
  startsAtZero: boolean,
  reachesEnd: boolean
): string {
  let bounded = text;
  if (!startsAtZero) {
    const firstNewline = bounded.indexOf('\n');
    bounded = firstNewline < 0 ? '' : bounded.slice(firstNewline + 1);
  }
  if (!reachesEnd || !bounded.endsWith('\n')) {
    const finalNewline = bounded.lastIndexOf('\n');
    bounded = finalNewline < 0 ? '' : bounded.slice(0, finalNewline + 1);
  }
  return bounded;
}

async function readMetadataSegments(
  path: string,
  before: CatalogSourceFingerprint,
  statFile: StatFile,
  prefixBytes: number,
  tailBytes: number
): Promise<MetadataSegments> {
  const handle = await open(path, 'r');
  try {
    const prefixLength = Math.min(before.size, prefixBytes);
    const prefixBuffer = Buffer.alloc(prefixLength);
    const prefixRead = await handle.read(prefixBuffer, 0, prefixLength, 0);
    const prefix = completePrefix(
      prefixBuffer.subarray(0, prefixRead.bytesRead).toString('utf8'),
      prefixRead.bytesRead >= before.size
    );

    const tailStart = Math.max(prefixRead.bytesRead, before.size - tailBytes);
    const tailLength = Math.max(0, before.size - tailStart);
    let tail = '';
    if (tailLength > 0) {
      const tailBuffer = Buffer.alloc(tailLength);
      const tailRead = await handle.read(tailBuffer, 0, tailLength, tailStart);
      tail = completeTail(
        tailBuffer.subarray(0, tailRead.bytesRead).toString('utf8'),
        tailStart === 0,
        tailStart + tailRead.bytesRead >= before.size
      );
    }

    return {
      lines: `${prefix}${tail}`
        .split(/\r?\n/)
        .filter((line) => line.length > 0),
      after: fingerprintOf(await statFile(path))
    };
  } finally {
    await handle.close();
  }
}

function objectScopes(record: Record<string, unknown>): Record<string, unknown>[] {
  const scopes: Record<string, unknown>[] = [];
  const visit = (value: Record<string, unknown>, depth: number): void => {
    scopes.push(value);
    if (depth >= 3) return;
    for (const key of ['data', 'metadata', 'session', 'context']) {
      const nested = value[key];
      if (typeof nested === 'object' && nested !== null && !Array.isArray(nested)) {
        visit(nested as Record<string, unknown>, depth + 1);
      }
    }
  };
  visit(record, 0);
  return scopes;
}

function firstString(
  scopes: readonly Record<string, unknown>[],
  fields: readonly string[]
): string | null {
  for (const scope of scopes) {
    for (const field of fields) {
      const value = scope[field];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }
  }
  return null;
}

function timestampOf(value: unknown): number | null {
  const timestamp =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Date.parse(value)
        : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
}

function parseMetadata(
  sessionId: string,
  lines: readonly string[],
  sourceKey: string,
  fingerprint: CatalogSourceFingerprint
): ProviderSessionRecord | null {
  const timestamps: number[] = [];
  let workspacePath: string | null = null;
  let title: string | null = null;

  for (const line of lines) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      continue;
    }
    const record = value as Record<string, unknown>;
    const timestamp = timestampOf(record.timestamp);
    if (timestamp !== null) timestamps.push(timestamp);
    const scopes = objectScopes(record);
    const candidateWorkspace = firstString(scopes, [
      'cwd',
      'workingDirectory',
      'workspacePath'
    ]);
    if (
      candidateWorkspace !== null &&
      isPortableAbsolutePath(candidateWorkspace)
    ) {
      workspacePath = candidateWorkspace;
    }

    const type = typeof record.type === 'string' ? record.type.toLowerCase() : '';
    if (
      type.includes('session') &&
      /creat|start|rename|name|title|metadata/.test(type)
    ) {
      const candidateTitle = firstString(scopes, [
        'name',
        'sessionName',
        'title'
      ]);
      if (candidateTitle !== null) title = candidateTitle.slice(0, 256);
    }
  }

  if (workspacePath === null || timestamps.length === 0) return null;
  const parsed = ProviderSessionRecordSchema.safeParse({
    provider: 'copilot',
    nativeId: sessionId,
    workspacePath,
    title: title ?? 'Untitled session',
    createdAt: new Date(Math.min(...timestamps)).toISOString(),
    updatedAt: new Date(Math.max(...timestamps)).toISOString(),
    source: { key: sourceKey, fingerprint }
  });
  return parsed.success ? parsed.data : null;
}

function reuseStoredSource(
  stored: StoredCatalogSource,
  sourceKey: string,
  fingerprint: CatalogSourceFingerprint
): ProviderSessionRecord | null {
  const parsed = ProviderSessionRecordSchema.safeParse({
    provider: stored.candidate.provider,
    nativeId: stored.candidate.nativeId,
    workspacePath: stored.candidate.workspace.canonicalPath,
    title: stored.candidate.title,
    createdAt: stored.candidate.createdAt,
    updatedAt: stored.candidate.updatedAt,
    source: { key: sourceKey, fingerprint }
  });
  return parsed.success && parsed.data.provider === 'copilot'
    ? parsed.data
    : null;
}

export async function discoverCopilotSessions({
  homeDirectory,
  env,
  lookupSource = async () => null,
  statFile = stat,
  maxFiles = 25_000,
  maxFileBytes = 64 * 1024 * 1024,
  prefixBytes = 256 * 1024,
  tailBytes = 64 * 1024
}: DiscoverCopilotOptions): Promise<ProviderSessionDiscoveryResult> {
  const configuredHome = environmentValue(env, 'COPILOT_HOME')?.trim();
  const configRoot =
    configuredHome === undefined || configuredHome.length === 0
      ? join(homeDirectory, '.copilot')
      : resolve(configuredHome);
  const enumeration = await enumerateEventLogs(
    join(configRoot, 'session-state'),
    Math.max(0, Math.trunc(maxFiles))
  );
  const sessions: ProviderSessionRecord[] = [];
  let invalidCount = enumeration.skipped;
  let unchangedCount = 0;

  for (const sourcePath of enumeration.paths) {
    try {
      const beforeStat = await statFile(sourcePath);
      const before = fingerprintOf(beforeStat);
      if (
        !beforeStat.isFile() ||
        before.size < 1 ||
        before.size > Math.max(1, Math.trunc(maxFileBytes))
      ) {
        invalidCount += 1;
        continue;
      }
      const stored = await lookupSource('copilot', sourcePath, before);
      let normalized: ProviderSessionRecord | null;
      if (stored !== null && sameFingerprint(stored.fingerprint, before)) {
        normalized = reuseStoredSource(stored, sourcePath, before);
        if (normalized !== null) unchangedCount += 1;
      } else {
        const segments = await readMetadataSegments(
          sourcePath,
          before,
          statFile,
          Math.max(1, Math.trunc(prefixBytes)),
          Math.max(1, Math.trunc(tailBytes))
        );
        if (!sameFingerprint(before, segments.after)) {
          invalidCount += 1;
          continue;
        }
        const sessionId = sourcePath.split(/[\\/]/).at(-2) ?? '';
        normalized = parseMetadata(
          sessionId,
          segments.lines,
          sourcePath,
          before
        );
      }
      if (normalized === null) {
        invalidCount += 1;
        continue;
      }
      sessions.push(normalized);
    } catch {
      invalidCount += 1;
    }
  }

  sessions.sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      left.nativeId.localeCompare(right.nativeId)
  );
  return {
    provider: 'copilot',
    sessions,
    discoveredCount: sessions.length,
    unchangedCount,
    invalidCount
  };
}
