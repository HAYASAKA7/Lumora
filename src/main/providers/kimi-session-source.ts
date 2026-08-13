import { createReadStream } from 'node:fs';
import {
  lstat,
  open,
  readdir,
  readFile,
  realpath,
  stat
} from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { ProviderId } from '../../shared/contracts';
import type { CatalogSourceFingerprint } from '../catalog/catalog-candidate';
import type { StoredCatalogSource } from '../storage/catalog-repository';
import {
  ProviderSessionRecordSchema,
  isPortableAbsolutePath,
  type ProviderSessionDiscoveryResult,
  type ProviderSessionRecord
} from './session-discovery';

interface FileStatLike {
  size: number;
  mtimeMs: number;
  isFile(): boolean;
}

type LookupSource = (
  provider: ProviderId,
  sourceKey: string,
  fingerprint: CatalogSourceFingerprint
) => Promise<StoredCatalogSource | null>;

interface DiscoverKimiOptions {
  kimiRoot: string;
  lookupSource?: LookupSource;
  maxIndexBytes?: number;
  maxIndexRecords?: number;
  maxStateBytes?: number;
  maxWireBytes?: number;
  maxAgentFiles?: number;
}

interface IndexRecord {
  sessionId: string;
  sessionDir: string;
  workDir: string;
}

const DEFAULT_INDEX_BYTES = 16 * 1024 * 1024;
const DEFAULT_INDEX_RECORDS = 25_000;
const DEFAULT_STATE_BYTES = 256 * 1024;
const DEFAULT_WIRE_BYTES = 64 * 1024 * 1024;
const DEFAULT_AGENT_FILES = 256;
const MAX_JSONL_LINE_BYTES = 2 * 1024 * 1024;
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

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
  return left !== null &&
    left.size === right.size &&
    left.modifiedAtMs === right.modifiedAtMs;
}

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedString(value: unknown, limit: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length > 0 && text.length <= limit && !/[\0\r\n]/.test(text)
    ? text
    : null;
}

function timestamp(value: unknown): string | null {
  const milliseconds = typeof value === 'number' ? value :
    typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(milliseconds)) return null;
  try {
    return new Date(milliseconds).toISOString();
  } catch {
    return null;
  }
}

async function boundedJsonLines(
  path: string,
  maxBytes: number,
  maxRecords: number
): Promise<{ records: unknown[]; invalid: number }> {
  const before = await stat(path);
  if (!before.isFile() || before.size < 1 || before.size > maxBytes) {
    throw new Error('Kimi session index is outside bounds.');
  }
  const records: unknown[] = [];
  let invalid = 0;
  const stream = createReadStream(path, { encoding: 'utf8' });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of reader) {
      if (Buffer.byteLength(line, 'utf8') > MAX_JSONL_LINE_BYTES) {
        invalid += 1;
        continue;
      }
      if (line.trim().length === 0) continue;
      if (records.length >= maxRecords) {
        invalid += 1;
        continue;
      }
      try {
        records.push(JSON.parse(line) as unknown);
      } catch {
        invalid += 1;
      }
    }
  } finally {
    reader.close();
    stream.destroy();
  }
  const after = await stat(path);
  if (after.size !== before.size || Math.trunc(after.mtimeMs) !== Math.trunc(before.mtimeMs)) {
    throw new Error('Kimi session index changed during scan.');
  }
  return { records, invalid };
}

function normalizeIndexRecord(value: unknown): IndexRecord | null {
  const record = objectValue(value);
  if (record === null) return null;
  const sessionId = boundedString(record.sessionId, 256);
  const sessionDir = boundedString(record.sessionDir, 32_768);
  const workDir = boundedString(record.workDir, 32_768);
  if (
    sessionId === null || !SESSION_ID_PATTERN.test(sessionId) ||
    sessionDir === null || !isPortableAbsolutePath(sessionDir) ||
    workDir === null || !isPortableAbsolutePath(workDir)
  ) return null;
  return { sessionId, sessionDir: resolve(sessionDir), workDir };
}

async function safeRegularFile(
  root: string,
  path: string,
  maxBytes: number
): Promise<{ fingerprint: CatalogSourceFingerprint; realPath: string }> {
  const entry = await lstat(path);
  if (entry.isSymbolicLink() || !entry.isFile() || entry.size < 1 || entry.size > maxBytes) {
    throw new Error('Kimi source is outside bounds.');
  }
  const canonical = await realpath(path);
  if (!inside(root, canonical)) throw new Error('Kimi source escaped its data root.');
  return { fingerprint: fingerprintOf(entry), realPath: canonical };
}

async function readStableFile(
  root: string,
  path: string,
  maxBytes: number
): Promise<{ raw: string; fingerprint: CatalogSourceFingerprint; realPath: string }> {
  const before = await safeRegularFile(root, path, maxBytes);
  const raw = await readFile(before.realPath, 'utf8');
  const after = await safeRegularFile(root, path, maxBytes);
  if (!sameFingerprint(before.fingerprint, after.fingerprint)) {
    throw new Error('Kimi source changed during scan.');
  }
  return { raw, fingerprint: before.fingerprint, realPath: before.realPath };
}

function stateMetadata(raw: string): {
  title: string;
  createdAt: string;
  updatedAt: string;
} | null {
  let state: Record<string, unknown> | null;
  try {
    state = objectValue(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
  if (state === null) return null;
  const title = boundedString(state.title, 256) ??
    boundedString(state.lastPrompt, 256) ??
    'Untitled session';
  const createdAt = timestamp(
    state.createdAt ?? state.created_at ?? state.creationTime ?? state.created
  );
  const updatedAt = timestamp(
    state.updatedAt ?? state.updated_at ?? state.updateTime ?? state.updated
  );
  if (createdAt === null || updatedAt === null || createdAt > updatedAt) return null;
  return { title, createdAt, updatedAt };
}

function safeCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function usageTokens(record: Record<string, unknown>): number | null | undefined {
  if (record.type !== 'usage.record') return undefined;
  const usage = objectValue(record.usage);
  if (usage === null) return null;
  const input = safeCount(usage.inputOther);
  const output = safeCount(usage.output);
  if (input === null || output === null || input > Number.MAX_SAFE_INTEGER - output) {
    return null;
  }
  return input + output;
}

async function lifetimeTokens(
  root: string,
  sessionDir: string,
  maxWireBytes: number,
  maxAgentFiles: number
): Promise<number | null> {
  const agentsRoot = join(sessionDir, 'agents');
  let agents;
  try {
    agents = await readdir(agentsRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  const wirePaths = agents
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, maxAgentFiles)
    .map((entry) => join(agentsRoot, entry.name, 'wire.jsonl'));
  if (wirePaths.length === 0 || agents.filter((entry) => entry.isDirectory()).length > maxAgentFiles) {
    return null;
  }
  let remaining = maxWireBytes;
  let total = 0;
  let sawUsage = false;
  for (const path of wirePaths) {
    let value;
    try {
      value = await readStableFile(root, path, remaining);
    } catch {
      return null;
    }
    remaining -= value.fingerprint.size;
    for (const line of value.raw.split(/\r?\n/)) {
      if (line.trim().length === 0) continue;
      if (Buffer.byteLength(line, 'utf8') > MAX_JSONL_LINE_BYTES) return null;
      let record: Record<string, unknown> | null;
      try {
        record = objectValue(JSON.parse(line) as unknown);
      } catch {
        return null;
      }
      if (record === null) return null;
      const tokens = usageTokens(record);
      if (tokens === null) return null;
      if (tokens !== undefined) {
        sawUsage = true;
        if (total > Number.MAX_SAFE_INTEGER - tokens) return null;
        total += tokens;
      }
    }
  }
  return sawUsage ? total : null;
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
  return parsed.success && parsed.data.provider === 'kimi' ? parsed.data : null;
}

export async function discoverKimiSessions({
  kimiRoot,
  lookupSource = async () => null,
  maxIndexBytes = DEFAULT_INDEX_BYTES,
  maxIndexRecords = DEFAULT_INDEX_RECORDS,
  maxStateBytes = DEFAULT_STATE_BYTES,
  maxWireBytes = DEFAULT_WIRE_BYTES,
  maxAgentFiles = DEFAULT_AGENT_FILES
}: DiscoverKimiOptions): Promise<ProviderSessionDiscoveryResult> {
  const root = resolve(kimiRoot);
  let rootReal: string;
  try {
    rootReal = await realpath(root);
  } catch {
    return { provider: 'kimi', sessions: [], discoveredCount: 0, unchangedCount: 0, invalidCount: 0 };
  }
  let index;
  try {
    index = await boundedJsonLines(
      join(rootReal, 'session_index.jsonl'),
      Math.max(1, Math.trunc(maxIndexBytes)),
      Math.max(1, Math.trunc(maxIndexRecords))
    );
  } catch {
    return { provider: 'kimi', sessions: [], discoveredCount: 0, unchangedCount: 0, invalidCount: 1 };
  }
  const sessionsRoot = join(rootReal, 'sessions');
  const sessions = new Map<string, ProviderSessionRecord>();
  let invalidCount = index.invalid;
  let unchangedCount = 0;
  for (const rawRecord of index.records) {
    const record = normalizeIndexRecord(rawRecord);
    if (record === null) { invalidCount += 1; continue; }
    try {
      const canonicalSessionDir = await realpath(record.sessionDir);
      if (!inside(sessionsRoot, canonicalSessionDir)) throw new Error('Kimi session escaped its root.');
      const sessionEntry = await lstat(record.sessionDir);
      if (sessionEntry.isSymbolicLink() || !sessionEntry.isDirectory()) throw new Error('Kimi session directory is invalid.');
      const statePath = join(canonicalSessionDir, 'state.json');
      const state = await readStableFile(rootReal, statePath, Math.max(1, Math.trunc(maxStateBytes)));
      const stored = await lookupSource('kimi', state.realPath, state.fingerprint);
      let normalized = stored !== null && sameFingerprint(stored.fingerprint, state.fingerprint)
        ? reuseStoredSource(stored, state.realPath, state.fingerprint)
        : null;
      if (normalized !== null) {
        unchangedCount += 1;
      } else {
        const metadata = stateMetadata(state.raw);
        if (metadata === null) throw new Error('Kimi state is invalid.');
        const parsed = ProviderSessionRecordSchema.safeParse({
          provider: 'kimi',
          nativeId: record.sessionId,
          workspacePath: record.workDir,
          ...metadata,
          lifetimeTokens: await lifetimeTokens(
            rootReal,
            canonicalSessionDir,
            Math.max(1, Math.trunc(maxWireBytes)),
            Math.max(1, Math.trunc(maxAgentFiles))
          ),
          source: { key: state.realPath, fingerprint: state.fingerprint }
        });
        if (!parsed.success) throw new Error('Kimi session metadata is invalid.');
        normalized = parsed.data;
      }
      const existing = sessions.get(normalized.nativeId);
      if (
        existing === undefined ||
        normalized.updatedAt > existing.updatedAt ||
        (normalized.updatedAt === existing.updatedAt && normalized.title > existing.title)
      ) sessions.set(normalized.nativeId, normalized);
    } catch {
      invalidCount += 1;
    }
  }
  const ordered = [...sessions.values()].sort(
    (left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.nativeId.localeCompare(right.nativeId)
  );
  return {
    provider: 'kimi',
    sessions: ordered,
    discoveredCount: ordered.length,
    unchangedCount,
    invalidCount
  };
}
