import { open, readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { ProviderId } from '../../shared/contracts';
import type { CatalogSourceFingerprint } from '../catalog/catalog-candidate';
import type { StoredCatalogSource } from '../storage/catalog-repository';
import {
  claudeLifetimeTokens,
  parseJsonLines
} from './provider-token-usage';
import {
  ProviderSessionRecordSchema,
  type ProviderSessionDiscoveryResult,
  type ProviderSessionRecord
} from './session-discovery';

const SESSION_EXTENSION = '.jsonl';
const CUSTOM_TITLE_FILE = 'custom-title.json';
const MAX_CUSTOM_TITLE_BYTES = 64 * 1024;
const MAX_TITLE_LENGTH = 256;

/**
 * Claude Code records a rename in two places: a `custom-title` transcript
 * record and an authoritative `custom-title.json` sidecar beside the
 * transcript. The sidecar is the only one that is guaranteed to exist and to
 * stay current, so it outranks anything recovered from the transcript.
 */
const TITLE_FIELDS = ['customTitle', 'aiTitle', 'sessionName'] as const;

type Environment = Readonly<Record<string, string | undefined>>;

interface SessionFileEntry {
  readonly path: string;
  readonly customTitlePath: string | null;
}

interface RankedTitle {
  readonly rank: number;
  readonly value: string;
}

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

interface DiscoverClaudeOptions {
  homeDirectory: string;
  env: Environment;
  lookupSource?: LookupSource;
  statFile?: StatFile;
  maxFiles?: number;
  prefixBytes?: number;
  tailBytes?: number;
  maxTokenBytes?: number;
}

interface MetadataSegments {
  lines: readonly string[];
  after: CatalogSourceFingerprint;
}

export class ClaudeSessionSourceError extends Error {
  readonly code = 'CLAUDE_SESSION_SOURCE_FAILED';

  constructor(message: string) {
    super(message);
    this.name = 'ClaudeSessionSourceError';
  }
}

function readEnvironmentValue(env: Environment, key: string): string | undefined {
  const exact = env[key];
  if (exact !== undefined) {
    return exact;
  }
  const matchingKey = Object.keys(env).find(
    (candidate) => candidate.toLowerCase() === key.toLowerCase()
  );
  return matchingKey === undefined ? undefined : env[matchingKey];
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
  projectsRoot: string,
  maxFiles: number
): Promise<{ files: SessionFileEntry[]; skipped: number }> {
  let projectEntries;
  try {
    projectEntries = await readdir(projectsRoot, { withFileTypes: true });
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return { files: [], skipped: 0 };
    }
    throw new ClaudeSessionSourceError(
      'Claude Code session storage could not be enumerated.'
    );
  }

  const files: SessionFileEntry[] = [];
  let skipped = 0;
  const projects = projectEntries
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const project of projects) {
    let entries;
    try {
      entries = await readdir(join(projectsRoot, project.name), {
        withFileTypes: true
      });
    } catch {
      skipped += 1;
      continue;
    }
    const sessionDirectories = new Set(
      entries.filter((value) => value.isDirectory()).map((value) => value.name)
    );
    for (const entry of entries
      .filter((value) => value.isFile() && value.name.endsWith('.jsonl'))
      .sort((left, right) => left.name.localeCompare(right.name))) {
      if (files.length >= maxFiles) {
        skipped += 1;
        continue;
      }
      const sessionName = entry.name.slice(0, -SESSION_EXTENSION.length);
      files.push({
        path: resolve(projectsRoot, project.name, entry.name),
        customTitlePath: sessionDirectories.has(sessionName)
          ? resolve(projectsRoot, project.name, sessionName, CUSTOM_TITLE_FILE)
          : null
      });
    }
  }

  return { files, skipped };
}

function completePrefix(text: string, reachesEnd: boolean): string {
  if (reachesEnd) {
    return text;
  }
  const newline = text.lastIndexOf('\n');
  return newline < 0 ? '' : text.slice(0, newline + 1);
}

function completeTail(text: string, startsAtZero: boolean, reachesEnd: boolean): string {
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

    const after = fingerprintOf(await statFile(path));
    return {
      lines: `${prefix}${tail}`.split(/\r?\n/).filter((line) => line.length > 0),
      after
    };
  } finally {
    await handle.close();
  }
}

function explicitTitle(record: Record<string, unknown>): RankedTitle | null {
  for (const [rank, field] of TITLE_FIELDS.entries()) {
    const value = record[field];
    if (typeof value === 'string' && value.trim().length > 0) {
      return { rank, value: value.trim().slice(0, MAX_TITLE_LENGTH) };
    }
  }
  return null;
}

/**
 * Reads the rename sidecar. A missing, oversized, malformed or empty sidecar
 * is not an error; the transcript title remains the fallback.
 */
async function readCustomTitle(path: string | null): Promise<string | null> {
  if (path === null) {
    return null;
  }
  try {
    const handle = await open(path, 'r');
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_CUSTOM_TITLE_BYTES) {
        return null;
      }
      const buffer = Buffer.alloc(info.size);
      const read = await handle.read(buffer, 0, info.size, 0);
      const parsed: unknown = JSON.parse(
        buffer.subarray(0, read.bytesRead).toString('utf8')
      );
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        return null;
      }
      const value = (parsed as Record<string, unknown>).customTitle;
      return typeof value === 'string' && value.trim().length > 0
        ? value.trim().slice(0, MAX_TITLE_LENGTH)
        : null;
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

function parseMetadata(
  lines: readonly string[],
  sourceKey: string,
  fingerprint: CatalogSourceFingerprint,
  lifetimeTokens: number | null
): ProviderSessionRecord | null {
  const nativeIds = new Set<string>();
  const workspacePaths = new Set<string>();
  const timestamps: number[] = [];
  let title: RankedTitle | null = null;

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
    if (typeof record.sessionId === 'string' && record.sessionId.trim()) {
      nativeIds.add(record.sessionId.trim());
    }
    if (typeof record.cwd === 'string' && record.cwd.trim()) {
      workspacePaths.add(record.cwd.trim());
    }
    if (typeof record.timestamp === 'string') {
      const parsedTimestamp = Date.parse(record.timestamp);
      if (Number.isFinite(parsedTimestamp)) {
        timestamps.push(parsedTimestamp);
      }
    }
    const candidate = explicitTitle(record);
    if (candidate !== null && (title === null || candidate.rank <= title.rank)) {
      title = candidate;
    }
  }

  if (
    nativeIds.size !== 1 ||
    workspacePaths.size !== 1 ||
    timestamps.length === 0
  ) {
    return null;
  }
  const createdAt = new Date(Math.min(...timestamps)).toISOString();
  const updatedAt = new Date(Math.max(...timestamps)).toISOString();

  const parsed = ProviderSessionRecordSchema.safeParse({
    provider: 'claude',
    nativeId: [...nativeIds][0],
    workspacePath: [...workspacePaths][0],
    title: title?.value ?? 'Untitled session',
    createdAt,
    updatedAt,
    lifetimeTokens,
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
    lifetimeTokens: stored.candidate.lifetimeTokens,
    source: { key: sourceKey, fingerprint }
  });
  return parsed.success && parsed.data.provider === 'claude' ? parsed.data : null;
}

export async function discoverClaudeSessions({
  homeDirectory,
  env,
  lookupSource = async () => null,
  statFile = stat,
  maxFiles = 25_000,
  prefixBytes = 256 * 1024,
  tailBytes = 64 * 1024,
  maxTokenBytes = 64 * 1024 * 1024
}: DiscoverClaudeOptions): Promise<ProviderSessionDiscoveryResult> {
  const configuredRoot = readEnvironmentValue(env, 'CLAUDE_CONFIG_DIR')?.trim();
  const configRoot =
    configuredRoot === undefined || configuredRoot.length === 0
      ? join(homeDirectory, '.claude')
      : resolve(configuredRoot);
  const enumeration = await enumerateSessionFiles(
    join(configRoot, 'projects'),
    Math.max(0, Math.trunc(maxFiles))
  );
  const sessions = new Map<string, ProviderSessionRecord>();
  let invalidCount = enumeration.skipped;
  let unchangedCount = 0;

  for (const entry of enumeration.files) {
    const sourcePath = entry.path;
    try {
      const beforeStat = await statFile(sourcePath);
      if (!beforeStat.isFile()) {
        invalidCount += 1;
        continue;
      }
      const before = fingerprintOf(beforeStat);
      const stored = await lookupSource('claude', sourcePath, before);
      let normalized: ProviderSessionRecord | null = null;
      if (stored !== null && sameFingerprint(stored.fingerprint, before)) {
        normalized = reuseStoredSource(stored, sourcePath, before);
        if (normalized !== null) {
          unchangedCount += 1;
        }
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
        let lifetimeTokens: number | null = null;
        if (before.size <= Math.max(1, Math.trunc(maxTokenBytes))) {
          const records = parseJsonLines(await readFile(sourcePath, 'utf8'));
          const afterUsage = fingerprintOf(await statFile(sourcePath));
          if (!sameFingerprint(before, afterUsage)) {
            invalidCount += 1;
            continue;
          }
          lifetimeTokens = claudeLifetimeTokens(records);
        }
        normalized = parseMetadata(
          segments.lines,
          sourcePath,
          before,
          lifetimeTokens
        );
      }

      if (normalized === null) {
        invalidCount += 1;
        continue;
      }
      const customTitle = await readCustomTitle(entry.customTitlePath);
      if (customTitle !== null && customTitle !== normalized.title) {
        normalized = { ...normalized, title: customTitle };
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
    provider: 'claude',
    sessions: orderedSessions,
    discoveredCount: orderedSessions.length,
    unchangedCount,
    invalidCount
  };
}
