import { open, readdir, stat } from 'node:fs/promises';
import { join, parse, resolve } from 'node:path';

import type { ProviderId } from '../../shared/contracts';
import type { CatalogSourceFingerprint } from '../catalog/catalog-candidate';
import type { StoredCatalogSource } from '../storage/catalog-repository';
import { isPortableAbsolutePath } from './session-discovery';
import {
  ProviderSessionRecordSchema,
  type ProviderSessionDiscoveryResult,
  type ProviderSessionRecord
} from './session-discovery';

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
interface DiscoverQwenOptions {
  qwenRoot: string;
  lookupSource?: LookupSource;
  statFile?: StatFile;
  maxFiles?: number;
  maxFileBytes?: number;
  prefixBytes?: number;
  tailBytes?: number;
}

const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
function fingerprintOf(value: FileStatLike): CatalogSourceFingerprint {
  return { size: Math.trunc(value.size), modifiedAtMs: Math.trunc(value.mtimeMs) };
}
function sameFingerprint(
  left: CatalogSourceFingerprint | null,
  right: CatalogSourceFingerprint
): boolean {
  return left !== null && left.size === right.size && left.modifiedAtMs === right.modifiedAtMs;
}

async function enumerateRecordings(
  qwenRoot: string,
  maxFiles: number
): Promise<{ paths: string[]; skipped: number }> {
  let projects;
  try {
    projects = await readdir(join(qwenRoot, 'projects'), { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return { paths: [], skipped: 0 };
    throw error;
  }
  const paths: string[] = [];
  let skipped = 0;
  for (const project of projects.filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    let chats;
    try {
      chats = await readdir(join(qwenRoot, 'projects', project.name, 'chats'), { withFileTypes: true });
    } catch (error) {
      if (!isMissing(error)) skipped += 1;
      continue;
    }
    for (const chat of chats.filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl')).sort((a, b) => a.name.localeCompare(b.name))) {
      if (paths.length >= maxFiles) {
        skipped += 1;
      } else {
        paths.push(resolve(qwenRoot, 'projects', project.name, 'chats', chat.name));
      }
    }
  }
  return { paths, skipped };
}

function completePrefix(text: string, reachesEnd: boolean): string {
  if (reachesEnd) return text;
  const newline = text.lastIndexOf('\n');
  return newline < 0 ? '' : text.slice(0, newline + 1);
}
function completeTail(text: string, startsAtZero: boolean, reachesEnd: boolean): string {
  let bounded = text;
  if (!startsAtZero) {
    const newline = bounded.indexOf('\n');
    bounded = newline < 0 ? '' : bounded.slice(newline + 1);
  }
  if (!reachesEnd || !bounded.endsWith('\n')) {
    const newline = bounded.lastIndexOf('\n');
    bounded = newline < 0 ? '' : bounded.slice(0, newline + 1);
  }
  return bounded;
}
async function readMetadataLines(
  path: string,
  before: CatalogSourceFingerprint,
  statFile: StatFile,
  prefixBytes: number,
  tailBytes: number
): Promise<{ lines: string[]; after: CatalogSourceFingerprint }> {
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
      lines: `${prefix}${tail}`.split(/\r?\n/).filter(Boolean),
      after: fingerprintOf(await statFile(path))
    };
  } finally {
    await handle.close();
  }
}

function timestampOf(value: unknown): number | null {
  const milliseconds = typeof value === 'string' ? Date.parse(value) : typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(milliseconds) ? milliseconds : null;
}
function normalizeRecording(
  expectedSessionId: string,
  lines: readonly string[],
  sourceKey: string,
  fingerprint: CatalogSourceFingerprint
): ProviderSessionRecord | null {
  const timestamps: number[] = [];
  let workspacePath: string | null = null;
  let title: string | null = null;
  let sawMatchingSession = false;
  for (const line of lines) {
    let value: unknown;
    try { value = JSON.parse(line); } catch { continue; }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    if (record.sessionId !== expectedSessionId) continue;
    sawMatchingSession = true;
    const timestamp = timestampOf(record.timestamp);
    if (timestamp !== null) timestamps.push(timestamp);
    if (typeof record.cwd === 'string' && isPortableAbsolutePath(record.cwd)) {
      workspacePath = record.cwd;
    }
    if (record.type === 'system' && record.subtype === 'custom_title') {
      const payload = record.systemPayload;
      if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
        const customTitle = (payload as Record<string, unknown>).customTitle;
        if (typeof customTitle === 'string' && customTitle.trim()) title = customTitle.trim().slice(0, 256);
      }
    }
  }
  if (!sawMatchingSession || workspacePath === null || timestamps.length === 0) return null;
  const parsedRecord = ProviderSessionRecordSchema.safeParse({
    provider: 'qwen',
    nativeId: expectedSessionId,
    workspacePath,
    title: title ?? 'Untitled session',
    createdAt: new Date(Math.min(...timestamps)).toISOString(),
    updatedAt: new Date(Math.max(...timestamps)).toISOString(),
    source: { key: sourceKey, fingerprint }
  });
  return parsedRecord.success ? parsedRecord.data : null;
}
function reuseStoredSource(
  stored: StoredCatalogSource,
  sourceKey: string,
  fingerprint: CatalogSourceFingerprint
): ProviderSessionRecord | null {
  const parsedRecord = ProviderSessionRecordSchema.safeParse({
    provider: stored.candidate.provider,
    nativeId: stored.candidate.nativeId,
    workspacePath: stored.candidate.workspace.canonicalPath,
    title: stored.candidate.title,
    createdAt: stored.candidate.createdAt,
    updatedAt: stored.candidate.updatedAt,
    source: { key: sourceKey, fingerprint }
  });
  return parsedRecord.success && parsedRecord.data.provider === 'qwen' ? parsedRecord.data : null;
}

export async function discoverQwenSessions({
  qwenRoot,
  lookupSource = async () => null,
  statFile = stat,
  maxFiles = 25_000,
  maxFileBytes = 64 * 1024 * 1024,
  prefixBytes = 256 * 1024,
  tailBytes = 64 * 1024
}: DiscoverQwenOptions): Promise<ProviderSessionDiscoveryResult> {
  const enumeration = await enumerateRecordings(resolve(qwenRoot), Math.max(0, Math.trunc(maxFiles)));
  const sessions = new Map<string, ProviderSessionRecord>();
  let invalidCount = enumeration.skipped;
  let unchangedCount = 0;
  for (const sourcePath of enumeration.paths) {
    try {
      const nativeId = parse(sourcePath).name;
      if (!SESSION_ID_PATTERN.test(nativeId)) { invalidCount += 1; continue; }
      const beforeStat = await statFile(sourcePath);
      const before = fingerprintOf(beforeStat);
      if (!beforeStat.isFile() || before.size < 1 || before.size > Math.max(1, Math.trunc(maxFileBytes))) {
        invalidCount += 1;
        continue;
      }
      const stored = await lookupSource('qwen', sourcePath, before);
      let normalized: ProviderSessionRecord | null;
      if (stored !== null && sameFingerprint(stored.fingerprint, before)) {
        normalized = reuseStoredSource(stored, sourcePath, before);
        if (normalized !== null) unchangedCount += 1;
      } else {
        const metadata = await readMetadataLines(
          sourcePath,
          before,
          statFile,
          Math.max(1, Math.trunc(prefixBytes)),
          Math.max(1, Math.trunc(tailBytes))
        );
        if (!sameFingerprint(before, metadata.after)) { invalidCount += 1; continue; }
        normalized = normalizeRecording(nativeId, metadata.lines, sourcePath, before);
      }
      if (normalized === null) { invalidCount += 1; continue; }
      const existing = sessions.get(normalized.nativeId);
      if (existing === undefined || normalized.updatedAt > existing.updatedAt || (normalized.updatedAt === existing.updatedAt && normalized.title > existing.title)) {
        sessions.set(normalized.nativeId, normalized);
      }
    } catch {
      invalidCount += 1;
    }
  }
  const ordered = [...sessions.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.nativeId.localeCompare(right.nativeId));
  return { provider: 'qwen', sessions: ordered, discoveredCount: ordered.length, unchangedCount, invalidCount };
}
