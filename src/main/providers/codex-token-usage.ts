import { open, stat } from 'node:fs/promises';

import type { CatalogSourceFingerprint } from '../catalog/catalog-candidate';

interface FileStatLike {
  size: number;
  mtimeMs: number;
  isFile(): boolean;
}

type StatFile = (path: string) => Promise<FileStatLike>;

interface InspectCodexLifetimeUsageOptions {
  sourcePath: string;
  maxBytes?: number;
  statFile?: StatFile;
}

export interface CodexLifetimeUsage {
  lifetimeTokens: number | null;
  fingerprint: CatalogSourceFingerprint;
}

const DEFAULT_TAIL_BYTES = 256 * 1024;

function fingerprintOf(value: FileStatLike): CatalogSourceFingerprint {
  return {
    size: Math.trunc(value.size),
    modifiedAtMs: Math.trunc(value.mtimeMs)
  };
}

function sameFingerprint(
  left: CatalogSourceFingerprint,
  right: CatalogSourceFingerprint
): boolean {
  return (
    left.size === right.size &&
    left.modifiedAtMs === right.modifiedAtMs
  );
}

function safeTokenCount(value: unknown): number | null {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
  )
    ? value
    : null;
}

function usedTokenTotal(value: unknown): number | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.type !== 'event_msg') return null;
  const payload = record.payload;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return null;
  }
  const payloadRecord = payload as Record<string, unknown>;
  if (payloadRecord.type !== 'token_count') return null;
  const info = payloadRecord.info;
  if (typeof info !== 'object' || info === null || Array.isArray(info)) {
    return null;
  }
  const totalUsage = (info as Record<string, unknown>).total_token_usage;
  if (
    typeof totalUsage !== 'object' ||
    totalUsage === null ||
    Array.isArray(totalUsage)
  ) {
    return null;
  }
  const usage = totalUsage as Record<string, unknown>;
  const inputTokens = safeTokenCount(usage.input_tokens);
  const cachedInputTokens = safeTokenCount(usage.cached_input_tokens ?? 0);
  const outputTokens = safeTokenCount(usage.output_tokens);
  if (
    inputTokens === null ||
    cachedInputTokens === null ||
    outputTokens === null
  ) {
    return null;
  }
  const usedTokens = Math.max(0, inputTokens - cachedInputTokens) + outputTokens;
  return Number.isSafeInteger(usedTokens) ? usedTokens : null;
}

function newestTokenTotal(text: string, startsAtZero: boolean): number | null {
  const firstNewline = text.indexOf('\n');
  const completeText = startsAtZero
    ? text
    : firstNewline < 0
      ? ''
      : text.slice(firstNewline + 1);
  const lines = completeText.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    const total = usedTokenTotal(value);
    if (total !== null) return total;
  }
  return null;
}

export async function inspectCodexLifetimeUsage({
  sourcePath,
  maxBytes = DEFAULT_TAIL_BYTES,
  statFile = stat
}: InspectCodexLifetimeUsageOptions): Promise<CodexLifetimeUsage | null> {
  const beforeStat = await statFile(sourcePath);
  if (!beforeStat.isFile() || beforeStat.size < 0) return null;
  const before = fingerprintOf(beforeStat);
  const requestedBytes = Math.max(1, Math.trunc(maxBytes));
  const length = Math.min(before.size, requestedBytes);
  const start = Math.max(0, before.size - length);
  const buffer = Buffer.alloc(length);
  const handle = await open(sourcePath, 'r');
  let bytesRead = 0;
  try {
    if (length > 0) {
      bytesRead = (await handle.read(buffer, 0, length, start)).bytesRead;
    }
  } finally {
    await handle.close();
  }
  const after = fingerprintOf(await statFile(sourcePath));
  if (!sameFingerprint(before, after)) return null;

  return {
    lifetimeTokens: newestTokenTotal(
      buffer.subarray(0, bytesRead).toString('utf8'),
      start === 0
    ),
    fingerprint: before
  };
}
