import { stat } from 'node:fs/promises';

import { z } from 'zod';

import type { SystemInfo } from '../../shared/contracts';
import { buildStructuredProcessInvocation, spawnStructuredLineTransport } from '../agent/transport/process-invocation';
import type { CatalogSourceFingerprint } from '../catalog/catalog-candidate';
import type { StoredCatalogSource } from '../storage/catalog-repository';
import {
  inspectCodexLifetimeUsage,
  type CodexLifetimeUsage
} from './codex-token-usage';
import {
  isPortableAbsolutePath,
  ProviderSessionRecordSchema,
  type ProviderSessionDiscoveryResult,
  type ProviderSessionRecord
} from './session-discovery';

type SupportedPlatform = SystemInfo['platform'];
type Environment = Readonly<Record<string, string | undefined>>;
interface FileStatLike {
  size: number;
  mtimeMs: number;
  isFile(): boolean;
}
type StatFile = (path: string) => Promise<FileStatLike>;
type LookupSource = (
  provider: 'codex',
  sourceKey: string,
  fingerprint: CatalogSourceFingerprint
) => Promise<StoredCatalogSource | null>;
type InspectUsage = (options: {
  sourcePath: string;
}) => Promise<CodexLifetimeUsage | null>;

export interface CodexAppServerInvocation {
  file: string;
  args: readonly string[];
  windowsVerbatimArguments?: boolean;
}

export interface CodexAppServerInvocationOptions {
  platform: SupportedPlatform;
  env: Environment;
}

export interface CodexAppServerTransport {
  request(method: string, params: unknown): Promise<unknown>;
  notify(method: string): Promise<void>;
  close(): Promise<void>;
}

type CreateTransport = (
  executablePath: string
) => Promise<CodexAppServerTransport>;

interface DiscoverCodexOptions {
  executablePath: string;
  createTransport?: CreateTransport;
  platform?: SupportedPlatform;
  env?: Environment;
  requestTimeoutMs?: number;
  pageSize?: number;
  maxPages?: number;
  lookupSource?: LookupSource;
  statFile?: StatFile;
  inspectUsage?: InspectUsage;
}

const ThreadSchema = z.object({
  id: z.string().trim().min(1).max(256),
  ephemeral: z.boolean(),
  cwd: z.string().min(1).max(32_768),
  createdAt: z.number().finite().nonnegative(),
  updatedAt: z.number().finite().nonnegative(),
  name: z.string().nullable(),
  path: z.string().nullable().optional()
});

const ThreadListEnvelopeSchema = z.object({
  data: z.array(z.unknown()),
  nextCursor: z.string().min(1).nullable()
});

export class CodexProtocolError extends Error {
  readonly code = 'CODEX_APP_SERVER_PROTOCOL_FAILED';

  constructor(message: string) {
    super(message);
    this.name = 'CodexProtocolError';
  }
}

export function buildCodexAppServerInvocation(
  executablePath: string,
  { platform, env }: CodexAppServerInvocationOptions
): CodexAppServerInvocation {
  try {
    const invocation = buildStructuredProcessInvocation(
      executablePath,
      ['app-server', '--stdio'],
      { platform, env }
    );
    return {
      file: invocation.file,
      args: invocation.args,
      ...(invocation.windowsVerbatimArguments
        ? { windowsVerbatimArguments: true }
        : {})
    };
  } catch (error) {
    throw new CodexProtocolError(
      error instanceof Error
        ? error.message
        : 'The Codex executable could not be invoked safely.'
    );
  }
}

export async function createCodexAppServerTransport(
  executablePath: string,
  options: CodexAppServerInvocationOptions
): Promise<CodexAppServerTransport> {
  return spawnStructuredLineTransport(
    executablePath,
    ['app-server', '--stdio'],
    {
      ...options,
      requestTimeoutMs: 10_000,
      maxFrameBytes: 1024 * 1024,
      closeGraceMs: 1_000
    }
  );
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new CodexProtocolError(`${operation} timed out.`)),
      timeoutMs
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

interface NormalizedCodexThread {
  session: ProviderSessionRecord;
  rolloutPath: string | null;
}

function normalizeThread(value: unknown): NormalizedCodexThread | null {
  const parsed = ThreadSchema.safeParse(value);
  if (!parsed.success || parsed.data.ephemeral) {
    return null;
  }
  const thread = parsed.data;
  if (
    !isPortableAbsolutePath(thread.cwd) ||
    thread.createdAt > thread.updatedAt
  ) {
    return null;
  }
  const createdAt = new Date(thread.createdAt * 1_000);
  const updatedAt = new Date(thread.updatedAt * 1_000);
  if (
    !Number.isFinite(createdAt.getTime()) ||
    !Number.isFinite(updatedAt.getTime())
  ) {
    return null;
  }
  const requestedTitle = thread.name?.trim() ?? '';

  return {
    session: ProviderSessionRecordSchema.parse({
      provider: 'codex',
      nativeId: thread.id,
      workspacePath: thread.cwd,
      title: requestedTitle.length > 0
        ? requestedTitle.slice(0, 256)
        : 'Untitled session',
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
      lifetimeTokens: null,
      source: { key: `thread:${thread.id}`, fingerprint: null }
    }),
    rolloutPath:
      typeof thread.path === 'string' && isPortableAbsolutePath(thread.path)
        ? thread.path
        : null
  };
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

async function enrichLifetimeUsage(
  normalized: NormalizedCodexThread,
  lookupSource: LookupSource,
  statFile: StatFile,
  inspectUsage: InspectUsage
): Promise<{ session: ProviderSessionRecord; unchanged: boolean }> {
  if (normalized.rolloutPath === null) {
    return { session: normalized.session, unchanged: false };
  }
  try {
    const file = await statFile(normalized.rolloutPath);
    if (!file.isFile() || file.size < 0) {
      return { session: normalized.session, unchanged: false };
    }
    const fingerprint = fingerprintOf(file);
    const stored = await lookupSource(
      'codex',
      normalized.rolloutPath,
      fingerprint
    );
    if (
      stored !== null &&
      sameFingerprint(stored.fingerprint, fingerprint)
    ) {
      return {
        session: {
          ...normalized.session,
          lifetimeTokens: stored.candidate.lifetimeTokens,
          source: {
            key: normalized.rolloutPath,
            fingerprint
          }
        },
        unchanged: true
      };
    }
    const inspected = await inspectUsage({
      sourcePath: normalized.rolloutPath
    });
    if (inspected === null) {
      return { session: normalized.session, unchanged: false };
    }
    return {
      session: {
        ...normalized.session,
        lifetimeTokens: inspected.lifetimeTokens,
        source: {
          key: normalized.rolloutPath,
          fingerprint: inspected.fingerprint
        }
      },
      unchanged: false
    };
  } catch {
    return { session: normalized.session, unchanged: false };
  }
}

export async function discoverCodexSessions({
  executablePath,
  createTransport,
  platform = process.platform as SupportedPlatform,
  env = process.env,
  requestTimeoutMs = 10_000,
  pageSize = 500,
  maxPages = 50,
  lookupSource = async () => null,
  statFile = stat,
  inspectUsage = inspectCodexLifetimeUsage
}: DiscoverCodexOptions): Promise<ProviderSessionDiscoveryResult> {
  const transport = await (createTransport ??
    ((path) => createCodexAppServerTransport(path, { platform, env })))(executablePath);
  const sessions = new Map<string, NormalizedCodexThread>();
  let invalidCount = 0;

  try {
    await withTimeout(
      transport.request('initialize', {
        clientInfo: {
          name: 'lumora',
          title: 'Lumora',
          version: '0.1.0'
        },
        capabilities: null
      }),
      requestTimeoutMs,
      'Codex App Server initialization'
    );
    await transport.notify('initialized');

    let cursor: string | null = null;
    let page = 0;
    do {
      if (page >= maxPages) {
        throw new CodexProtocolError(
          'Codex App Server thread listing exceeded its page limit.'
        );
      }
      const rawPage = await withTimeout(
        transport.request('thread/list', {
          cursor,
          limit: pageSize,
          sortKey: 'updated_at',
          sortDirection: 'desc',
          useStateDbOnly: false
        }),
        requestTimeoutMs,
        'Codex App Server thread listing'
      );
      const parsedPage = ThreadListEnvelopeSchema.safeParse(rawPage);
      if (!parsedPage.success) {
        throw new CodexProtocolError(
          'Codex App Server returned an invalid thread-list protocol response.'
        );
      }

      for (const rawThread of parsedPage.data.data) {
        const rawEphemeral =
          typeof rawThread === 'object' &&
          rawThread !== null &&
          'ephemeral' in rawThread &&
          rawThread.ephemeral === true;
        const normalized = normalizeThread(rawThread);
        if (normalized === null) {
          if (!rawEphemeral) {
            invalidCount += 1;
          }
          continue;
        }
        const existing = sessions.get(normalized.session.nativeId);
        if (
          existing === undefined ||
          normalized.session.updatedAt > existing.session.updatedAt ||
          (normalized.session.updatedAt === existing.session.updatedAt &&
            normalized.session.title > existing.session.title)
        ) {
          sessions.set(normalized.session.nativeId, normalized);
        }
      }

      cursor = parsedPage.data.nextCursor;
      page += 1;
    } while (cursor !== null);

    const ordered = [...sessions.values()].sort(
      (left, right) =>
        right.session.updatedAt.localeCompare(left.session.updatedAt) ||
        left.session.nativeId.localeCompare(right.session.nativeId)
    );
    const orderedSessions: ProviderSessionRecord[] = [];
    let unchangedCount = 0;
    for (const normalized of ordered) {
      const enriched = await enrichLifetimeUsage(
        normalized,
        lookupSource,
        statFile,
        inspectUsage
      );
      orderedSessions.push(enriched.session);
      if (enriched.unchanged) unchangedCount += 1;
    }
    return {
      provider: 'codex',
      sessions: orderedSessions,
      discoveredCount: orderedSessions.length,
      unchangedCount,
      invalidCount
    };
  } finally {
    await transport.close();
  }
}
