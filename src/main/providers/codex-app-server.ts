import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { posix, win32 } from 'node:path';

import { z } from 'zod';

import type { SystemInfo } from '../../shared/contracts';
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

interface InvocationOptions {
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

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
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

function readWindowsEnvironmentValue(
  env: Environment,
  key: string
): string | undefined {
  const matchingKey = Object.keys(env).find(
    (candidate) => candidate.toLowerCase() === key.toLowerCase()
  );
  return matchingKey === undefined ? undefined : env[matchingKey];
}

export function buildCodexAppServerInvocation(
  executablePath: string,
  { platform, env }: InvocationOptions
): CodexAppServerInvocation {
  const pathApi = platform === 'win32' ? win32 : posix;
  if (!pathApi.isAbsolute(executablePath)) {
    throw new CodexProtocolError('The Codex executable path must be absolute.');
  }

  const isWindowsWrapper =
    platform === 'win32' && /\.(?:cmd|bat)$/i.test(executablePath);
  if (!isWindowsWrapper) {
    return { file: executablePath, args: ['app-server', '--stdio'] };
  }

  if (/["\r\n%]/.test(executablePath)) {
    throw new CodexProtocolError(
      'The Codex command wrapper path cannot be invoked safely.'
    );
  }

  const commandProcessor =
    readWindowsEnvironmentValue(env, 'ComSpec') ?? 'cmd.exe';
  return {
    file: commandProcessor,
    args: [
      '/d',
      '/s',
      '/c',
      `""${executablePath}" app-server --stdio"`
    ],
    windowsVerbatimArguments: true
  };
}

class JsonLineCodexTransport implements CodexAppServerTransport {
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private buffer = '';
  private outputBytes = 0;
  private failed: Error | null = null;
  private exited = false;

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly requestTimeoutMs = 10_000,
    private readonly maxOutputBytes = 1024 * 1024
  ) {
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.acceptOutput(chunk));
    child.stderr.on('data', (chunk: string) => this.countOutput(chunk));
    child.on('error', () =>
      this.fail(
        new CodexProtocolError('The Codex App Server process could not start.')
      )
    );
    child.on('exit', () => {
      this.exited = true;
      if (this.pending.size > 0) {
        this.fail(
          new CodexProtocolError(
            'The Codex App Server exited before completing a request.'
          )
        );
      }
    });
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.failed !== null) {
      return Promise.reject(this.failed);
    }

    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = new CodexProtocolError(
          `Codex App Server request ${method} timed out.`
        );
        reject(error);
        this.fail(error);
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ method, id, params }).catch((error: unknown) => {
        clearTimeout(timer);
        this.pending.delete(id);
        const normalized =
          error instanceof Error
            ? error
            : new CodexProtocolError('Codex App Server input failed.');
        reject(normalized);
        this.fail(normalized);
      });
    });
  }

  async notify(method: string): Promise<void> {
    await this.write({ method });
  }

  async close(): Promise<void> {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(
        new CodexProtocolError('The Codex App Server connection was closed.')
      );
    }
    this.pending.clear();

    if (this.exited) {
      return;
    }

    this.child.stdin.end();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.child.kill();
        resolve();
      }, 1_000);
      this.child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private write(message: unknown): Promise<void> {
    if (this.failed !== null) {
      return Promise.reject(this.failed);
    }

    return new Promise((resolve, reject) => {
      this.child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
        if (error) {
          reject(
            new CodexProtocolError('Codex App Server input could not be written.')
          );
          return;
        }
        resolve();
      });
    });
  }

  private countOutput(chunk: string): boolean {
    this.outputBytes += Buffer.byteLength(chunk);
    if (this.outputBytes <= this.maxOutputBytes) {
      return true;
    }

    this.fail(
      new CodexProtocolError('Codex App Server output exceeded its safety limit.')
    );
    return false;
  }

  private acceptOutput(chunk: string): void {
    if (!this.countOutput(chunk)) {
      return;
    }

    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line.length > 0) {
        this.acceptLine(line);
      }
      newline = this.buffer.indexOf('\n');
    }
  }

  private acceptLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      this.fail(
        new CodexProtocolError('Codex App Server returned invalid JSON protocol data.')
      );
      return;
    }

    if (typeof message !== 'object' || message === null || !('id' in message)) {
      return;
    }
    const response = message as {
      id?: unknown;
      result?: unknown;
      error?: unknown;
    };
    if (typeof response.id !== 'number') {
      return;
    }
    const pending = this.pending.get(response.id);
    if (pending === undefined) {
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(response.id);
    if (response.error !== undefined) {
      pending.reject(
        new CodexProtocolError('Codex App Server returned a protocol error.')
      );
      return;
    }
    pending.resolve(response.result);
  }

  private fail(error: Error): void {
    if (this.failed !== null) {
      return;
    }
    this.failed = error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    if (!this.exited) {
      this.child.kill();
    }
  }
}

async function createProcessTransport(
  executablePath: string,
  options: InvocationOptions
): Promise<CodexAppServerTransport> {
  const invocation = buildCodexAppServerInvocation(executablePath, options);
  const child = spawn(invocation.file, [...invocation.args], {
    env: { ...options.env, NO_COLOR: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments ?? false
  });
  return new JsonLineCodexTransport(child);
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
    ((path) => createProcessTransport(path, { platform, env })))(executablePath);
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
