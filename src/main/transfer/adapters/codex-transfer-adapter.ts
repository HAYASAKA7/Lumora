import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { z } from 'zod';

import type { ProviderInstallation, SystemInfo } from '../../../shared/contracts';
import {
  createCodexAppServerTransport,
  discoverCodexSessions,
  type CodexAppServerTransport
} from '../../providers/codex-app-server';
import {
  isPortableAbsolutePath,
  type ProviderSessionDiscoveryResult,
  type ProviderSessionRecord
} from '../../providers/session-discovery';
import { assertRegularFile } from '../transfer-path-safety';
import type {
  ProviderExportPayload,
  ProviderImportInspection,
  ProviderTransferAdapter,
  VerifiedTransferRoute
} from '../transfer-adapter';
import { VERIFIED_TRANSFER_ROUTES } from '../verified-transfer-routes';

type Environment = Readonly<Record<string, string | undefined>>;
type ReadyInstallation = Extract<ProviderInstallation, { state: 'ready' }>;
type CreateTransport = (executablePath: string) => Promise<CodexAppServerTransport>;

const MAX_HEADER_BYTES = 64 * 1024;
const MAX_METADATA_LINE_BYTES = 2 * 1024 * 1024;
const MAX_NATIVE_BYTES = 2 * 1024 * 1024 * 1024;
const SAFE_NATIVE_ID = /^[A-Za-z0-9._:-]{1,256}$/;

const CodexEnvelopeHeaderSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provider: z.literal('codex'),
  nativeSessionId: z.string().regex(SAFE_NATIVE_ID),
  workspacePath: z.string().min(1).max(32_768).refine(isPortableAbsolutePath),
  title: z.string().trim().min(1).max(256),
  nativeSize: z.number().int().positive().max(MAX_NATIVE_BYTES),
  nativeSha256: z.string().regex(/^[a-f0-9]{64}$/)
});
type CodexEnvelopeHeader = z.infer<typeof CodexEnvelopeHeaderSchema>;

const SessionMetaSchema = z.object({
  type: z.literal('session_meta'),
  payload: z.object({
    id: z.string().regex(SAFE_NATIVE_ID).optional(),
    session_id: z.string().regex(SAFE_NATIVE_ID).optional(),
    cwd: z.string().min(1).max(32_768).refine(isPortableAbsolutePath),
    forked_from_id: z.string().regex(SAFE_NATIVE_ID).optional()
  })
});

const ForkResponseSchema = z.object({
  thread: z.object({
    id: z.string().regex(SAFE_NATIVE_ID),
    cwd: z.string().min(1).max(32_768).refine(isPortableAbsolutePath),
    path: z.string().min(1).max(32_768).refine(isPortableAbsolutePath).nullable().optional()
  })
});

const ForkIdentitySchema = z.object({
  thread: z.object({
    id: z.string().regex(SAFE_NATIVE_ID)
  })
});

export class CodexTransferError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'CodexTransferError';
  }
}

interface CreateCodexTransferAdapterOptions {
  platform: SystemInfo['platform'];
  env: Environment;
  codexHome: string;
  createTransport?: CreateTransport;
  discoverSessions?: (installation: ReadyInstallation) => Promise<ProviderSessionDiscoveryResult>;
  verifiedRoutes?: readonly VerifiedTransferRoute[];
}

interface RolloutMetadata {
  nativeSessionId: string;
  workspacePath: string;
  forkedFromId: string | null;
}

interface ReadEnvelopeResult {
  header: CodexEnvelopeHeader;
  nativeOffset: number;
}

function assertInstallation(installation: ReadyInstallation): void {
  if (installation.provider !== 'codex') {
    throw new CodexTransferError(
      'CODEX_INSTALLATION_INVALID',
      'Codex transfer requires a Codex CLI installation.'
    );
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('The Codex transfer was cancelled.');
  error.name = 'AbortError';
  throw error;
}

function insideRoot(root: string, candidate: string): boolean {
  const value = relative(resolve(root), resolve(candidate));
  return value.length > 0 && !value.startsWith('..') && !isAbsolute(value);
}

async function readFirstLine(path: string, maxBytes: number): Promise<{ line: string; bytes: number }> {
  const handle = await open(path, 'r');
  try {
    const chunks: Buffer[] = [];
    let total = 0;
    while (total < maxBytes) {
      const chunk = Buffer.alloc(Math.min(16 * 1024, maxBytes - total));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, total);
      if (bytesRead === 0) break;
      const slice = chunk.subarray(0, bytesRead);
      const newline = slice.indexOf(0x0a);
      if (newline >= 0) {
        chunks.push(slice.subarray(0, newline));
        return {
          line: Buffer.concat(chunks).toString('utf8').replace(/\r$/, ''),
          bytes: total + newline + 1
        };
      }
      chunks.push(slice);
      total += bytesRead;
    }
  } finally {
    await handle.close();
  }
  throw new CodexTransferError(
    'CODEX_PAYLOAD_INVALID',
    'Codex transfer metadata is missing or exceeds its size limit.'
  );
}

async function readRolloutMetadata(path: string): Promise<RolloutMetadata> {
  const { line } = await readFirstLine(path, MAX_METADATA_LINE_BYTES);
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new CodexTransferError('CODEX_PAYLOAD_INVALID', 'Codex rollout metadata is invalid.');
  }
  const parsed = SessionMetaSchema.safeParse(value);
  if (!parsed.success) {
    throw new CodexTransferError('CODEX_PAYLOAD_INVALID', 'Codex rollout metadata is invalid.');
  }
  const id = parsed.data.payload.id ?? parsed.data.payload.session_id;
  if (id === undefined) {
    throw new CodexTransferError('CODEX_PAYLOAD_INVALID', 'Codex rollout identity is missing.');
  }
  return {
    nativeSessionId: id,
    workspacePath: parsed.data.payload.cwd,
    forkedFromId: parsed.data.payload.forked_from_id ?? null
  };
}

async function fileDigest(path: string): Promise<{ size: number; sha256: string }> {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_NATIVE_BYTES) {
      throw new CodexTransferError('CODEX_SOURCE_INVALID', 'Codex rollout exceeds the transfer size limit.');
    }
    hash.update(buffer);
  }
  if (size < 2) {
    throw new CodexTransferError('CODEX_SOURCE_INVALID', 'Codex rollout is empty.');
  }
  return { size, sha256: hash.digest('hex') };
}

async function readEnvelope(payloadPath: string): Promise<ReadEnvelopeResult> {
  const payloadSize = await assertRegularFile(payloadPath);
  const first = await readFirstLine(payloadPath, MAX_HEADER_BYTES);
  let value: unknown;
  try {
    value = JSON.parse(first.line);
  } catch {
    throw new CodexTransferError('CODEX_PAYLOAD_INVALID', 'Codex transfer payload is invalid.');
  }
  const parsed = CodexEnvelopeHeaderSchema.safeParse(value);
  if (!parsed.success || payloadSize !== first.bytes + parsed.data.nativeSize) {
    throw new CodexTransferError('CODEX_PAYLOAD_INVALID', 'Codex transfer payload is invalid.');
  }
  return { header: parsed.data, nativeOffset: first.bytes };
}

async function extractNativeRollout(
  payloadPath: string,
  nativeOffset: number,
  destination: string,
  expected: CodexEnvelopeHeader
): Promise<void> {
  await pipeline(
    createReadStream(payloadPath, { start: nativeOffset }),
    createWriteStream(destination, { flags: 'wx' })
  );
  const digest = await fileDigest(destination);
  if (digest.size !== expected.nativeSize || digest.sha256 !== expected.nativeSha256) {
    await rm(destination, { force: true });
    throw new CodexTransferError('CODEX_PAYLOAD_INVALID', 'Codex transfer checksum verification failed.');
  }
  const metadata = await readRolloutMetadata(destination);
  if (metadata.nativeSessionId !== expected.nativeSessionId ||
      metadata.workspacePath !== expected.workspacePath) {
    await rm(destination, { force: true });
    throw new CodexTransferError('CODEX_PAYLOAD_INVALID', 'Codex transfer metadata does not match its rollout.');
  }
}

async function importedFork(
  result: ProviderSessionDiscoveryResult,
  originalNativeId: string,
  workspacePath: string,
  sessionsRoot: string
): Promise<ProviderSessionRecord | null> {
  for (const session of result.sessions) {
    if (session.provider !== 'codex' || session.workspacePath !== workspacePath ||
        !insideRoot(sessionsRoot, session.source.key)) continue;
    try {
      const metadata = await readRolloutMetadata(session.source.key);
      if (metadata.forkedFromId === originalNativeId) return session;
    } catch {
      // Ignore unrelated or concurrently changing provider rollouts.
    }
  }
  return null;
}

export function createCodexTransferAdapter({
  platform,
  env,
  codexHome,
  createTransport = (executablePath) =>
    createCodexAppServerTransport(executablePath, { platform, env }),
  discoverSessions = (installation) => discoverCodexSessions({
    executablePath: installation.executablePath,
    platform,
    env
  }),
  verifiedRoutes = VERIFIED_TRANSFER_ROUTES
}: CreateCodexTransferAdapterOptions): ProviderTransferAdapter {
  const sessionsRoot = resolve(codexHome, 'sessions');

  const withTransport = async <T>(
    installation: ReadyInstallation,
    operation: (transport: CodexAppServerTransport) => Promise<T>
  ): Promise<T> => {
    const transport = await createTransport(installation.executablePath);
    try {
      await transport.request('initialize', {
        clientInfo: { name: 'lumora', title: 'Lumora', version: '0.1.0' },
        capabilities: { experimentalApi: true }
      });
      await transport.notify('initialized');
      return await operation(transport);
    } finally {
      await transport.close();
    }
  };

  return {
    provider: 'codex',
    capabilities(input) {
      const route = verifiedRoutes.some((candidate) =>
        candidate.provider === 'codex' &&
        candidate.sourcePlatform === input.sourcePlatform &&
        candidate.destinationPlatform === input.destinationPlatform &&
        candidate.providerVersion === input.providerVersion
      );
      return { export: route, import: route };
    },
    async exportSession(input): Promise<ProviderExportPayload> {
      assertInstallation(input.installation);
      throwIfAborted(input.signal);
      if (input.sourceKeys.length !== 1) {
        throw new CodexTransferError('CODEX_SOURCE_INVALID', 'Codex transfer requires one native rollout.');
      }
      const sourcePath = resolve(input.sourceKeys[0]!);
      if (!insideRoot(sessionsRoot, sourcePath) || !sourcePath.endsWith('.jsonl')) {
        throw new CodexTransferError('CODEX_SOURCE_INVALID', 'Codex rollout is outside provider storage.');
      }
      const before = await stat(sourcePath);
      if (!before.isFile() || before.size < 2 || before.size > MAX_NATIVE_BYTES) {
        throw new CodexTransferError('CODEX_SOURCE_INVALID', 'Codex rollout is unavailable or too large.');
      }
      const metadata = await readRolloutMetadata(sourcePath);
      if (metadata.nativeSessionId !== input.nativeSessionId ||
          metadata.workspacePath !== input.expectedWorkspacePath) {
        throw new CodexTransferError('CODEX_SOURCE_CHANGED', 'Codex rollout changed before export.');
      }
      const digest = await fileDigest(sourcePath);
      const afterDigest = await stat(sourcePath);
      if (before.size !== afterDigest.size || before.mtimeMs !== afterDigest.mtimeMs) {
        throw new CodexTransferError('CODEX_SOURCE_CHANGED', 'Codex rollout changed while being exported.');
      }
      const header: CodexEnvelopeHeader = {
        schemaVersion: 1,
        provider: 'codex',
        nativeSessionId: metadata.nativeSessionId,
        workspacePath: metadata.workspacePath,
        title: input.expectedTitle,
        nativeSize: digest.size,
        nativeSha256: digest.sha256
      };
      const payloadPath = join(input.stagingDirectory, 'codex-session.bin');
      const headerBytes = Buffer.from(`${JSON.stringify(header)}\n`, 'utf8');
      await writeFile(payloadPath, headerBytes, { flag: 'wx' });
      try {
        await pipeline(createReadStream(sourcePath), createWriteStream(payloadPath, { flags: 'a' }));
        const afterCopy = await stat(sourcePath);
        if (before.size !== afterCopy.size || before.mtimeMs !== afterCopy.mtimeMs) {
          throw new CodexTransferError('CODEX_SOURCE_CHANGED', 'Codex rollout changed while being exported.');
        }
      } catch (error) {
        await rm(payloadPath, { force: true });
        throw error;
      }
      return {
        provider: 'codex',
        nativeSessionId: header.nativeSessionId,
        workspacePath: header.workspacePath,
        title: header.title,
        payloadPath,
        size: headerBytes.length + header.nativeSize
      };
    },
    async inspectImport(input): Promise<ProviderImportInspection> {
      const envelope = await readEnvelope(input.payloadPath);
      return {
        provider: 'codex',
        nativeSessionId: envelope.header.nativeSessionId,
        workspacePath: envelope.header.workspacePath,
        title: envelope.header.title,
        payloadPath: input.payloadPath
      };
    },
    async importSession(input) {
      assertInstallation(input.installation);
      if (!isPortableAbsolutePath(input.destinationWorkspacePath)) {
        throw new CodexTransferError('CODEX_WORKSPACE_PATH_INVALID', 'Codex import requires an absolute workspace.');
      }
      throwIfAborted(input.signal);
      const envelope = await readEnvelope(input.inspection.payloadPath);
      if (envelope.header.nativeSessionId !== input.inspection.nativeSessionId ||
          envelope.header.workspacePath !== input.inspection.workspacePath ||
          envelope.header.title !== input.inspection.title) {
        throw new CodexTransferError('CODEX_SOURCE_CHANGED', 'Codex staged payload changed before import.');
      }
      const before = await discoverSessions(input.installation);
      const sameId = before.sessions.find((session) =>
        session.provider === 'codex' && session.nativeId === envelope.header.nativeSessionId
      );
      if (sameId !== undefined) {
        return { status: 'duplicate' as const, nativeSessionId: sameId.nativeId };
      }
      const priorFork = await importedFork(
        before,
        envelope.header.nativeSessionId,
        input.destinationWorkspacePath,
        sessionsRoot
      );
      if (priorFork !== null) {
        return { status: 'duplicate' as const, nativeSessionId: priorFork.nativeId };
      }

      const stagedRollout = join(input.stagingDirectory, 'codex-rollout.jsonl');
      await extractNativeRollout(
        input.inspection.payloadPath,
        envelope.nativeOffset,
        stagedRollout,
        envelope.header
      );
      throwIfAborted(input.signal);
      return withTransport(input.installation, async (transport) => {
        let createdThreadId: string | null = null;
        try {
          const raw = await transport.request('thread/fork', {
            threadId: envelope.header.nativeSessionId,
            path: stagedRollout,
            cwd: input.destinationWorkspacePath,
            ephemeral: false
          });
          const identity = ForkIdentitySchema.safeParse(raw);
          createdThreadId = identity.success ? identity.data.thread.id : null;
          const parsed = ForkResponseSchema.safeParse(raw);
          if (!parsed.success || parsed.data.thread.cwd !== input.destinationWorkspacePath) {
            throw new CodexTransferError('CODEX_IMPORT_RESULT_INVALID', 'Codex returned an invalid imported thread.');
          }
          throwIfAborted(input.signal);
          await transport.request('thread/name/set', {
            threadId: parsed.data.thread.id,
            name: envelope.header.title
          });
          return {
            status: 'imported' as const,
            nativeSessionId: parsed.data.thread.id,
            payloadPath: parsed.data.thread.path ?? stagedRollout
          };
        } catch (error) {
          if (createdThreadId !== null) {
            await transport.request('thread/delete', { threadId: createdThreadId }).catch(() => undefined);
          }
          throw error;
        }
      });
    },
    async verifyImportedSession(input) {
      assertInstallation(input.installation);
      const discovered = await discoverSessions(input.installation);
      return discovered.sessions.some((session) =>
        session.provider === 'codex' &&
        session.nativeId === input.nativeSessionId &&
        session.workspacePath === input.workspacePath &&
        session.title === input.title
      );
    },
    async rollbackImport(input) {
      assertInstallation(input.installation);
      await withTransport(input.installation, async (transport) => {
        await transport.request('thread/delete', { threadId: input.nativeSessionId });
      });
    }
  };
}
