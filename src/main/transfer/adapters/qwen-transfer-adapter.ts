import { readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';

import { z } from 'zod';

import type { ProviderInstallation, SystemInfo } from '../../../shared/contracts';
import { discoverQwenSessions } from '../../providers/qwen-session-source';
import {
  isPortableAbsolutePath,
  type ProviderSessionDiscoveryResult
} from '../../providers/session-discovery';
import { assertRegularFile } from '../transfer-path-safety';
import type {
  ProviderExportPayload,
  ProviderImportInspection,
  ProviderTransferAdapter,
  VerifiedTransferRoute
} from '../transfer-adapter';
import { VERIFIED_TRANSFER_ROUTES } from '../verified-transfer-routes';

type ReadyInstallation = Extract<ProviderInstallation, { state: 'ready' }>;
const MAX_NATIVE_PAYLOAD_BYTES = 64 * 1024 * 1024;
const MAX_ENVELOPE_BYTES = 96 * 1024 * 1024;
const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const QwenEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provider: z.literal('qwen'),
  nativeSessionId: z.string().regex(SESSION_ID_PATTERN),
  workspacePath: z.string().min(1).max(32_768).refine(isPortableAbsolutePath),
  title: z.string().trim().min(1).max(256),
  nativePayload: z.string().min(2)
});
type QwenEnvelope = z.infer<typeof QwenEnvelopeSchema>;

interface QwenNativeMetadata {
  nativeSessionId: string;
  workspacePath: string;
  title: string;
  records: Record<string, unknown>[];
}

export class QwenTransferError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'QwenTransferError';
  }
}

export function qwenProjectDirectoryName(
  workspacePath: string,
  platform: SystemInfo['platform']
): string {
  const normalized = platform === 'win32' ? workspacePath.toLocaleLowerCase() : workspacePath;
  return normalized.replace(/[^a-zA-Z0-9]/g, '-');
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseRecords(raw: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new QwenTransferError('QWEN_PAYLOAD_INVALID', 'Qwen session JSONL is invalid.');
    }
    const record = objectRecord(value);
    if (record === null) {
      throw new QwenTransferError('QWEN_PAYLOAD_INVALID', 'Qwen session JSONL is invalid.');
    }
    records.push(record);
  }
  if (records.length === 0) {
    throw new QwenTransferError('QWEN_PAYLOAD_INVALID', 'Qwen session JSONL is empty.');
  }
  return records;
}

function nativeMetadata(raw: string): QwenNativeMetadata {
  const records = parseRecords(raw);
  const sessionIds = new Set(records.flatMap((record) =>
    typeof record.sessionId === 'string' ? [record.sessionId] : []
  ));
  if (sessionIds.size !== 1) {
    throw new QwenTransferError('QWEN_PAYLOAD_INVALID', 'Qwen session identity is inconsistent.');
  }
  const nativeSessionId = [...sessionIds][0]!;
  if (!SESSION_ID_PATTERN.test(nativeSessionId)) {
    throw new QwenTransferError('QWEN_PAYLOAD_INVALID', 'Qwen session identity is invalid.');
  }
  const workspacePaths = records.flatMap((record) =>
    typeof record.cwd === 'string' && isPortableAbsolutePath(record.cwd) ? [record.cwd] : []
  );
  if (workspacePaths.length === 0 || new Set(workspacePaths).size !== 1) {
    throw new QwenTransferError('QWEN_PAYLOAD_INVALID', 'Qwen workspace metadata is inconsistent.');
  }
  let title = 'Untitled session';
  for (const record of records) {
    if (record.type !== 'system' || record.subtype !== 'custom_title') continue;
    const payload = objectRecord(record.systemPayload);
    const candidate = payload?.customTitle;
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      title = candidate.trim().slice(0, 256);
    }
  }
  return {
    nativeSessionId,
    workspacePath: workspacePaths[0]!,
    title,
    records
  };
}

function insideRoot(root: string, candidate: string): boolean {
  const value = relative(resolve(root), resolve(candidate));
  return value.length > 0 && !value.startsWith('..') && !isAbsolute(value);
}

async function stableRead(path: string, maxBytes: number): Promise<string> {
  const before = await stat(path);
  if (!before.isFile() || before.size < 2 || before.size > maxBytes) {
    throw new QwenTransferError('QWEN_SOURCE_INVALID', 'Qwen session source is unavailable or too large.');
  }
  const raw = await readFile(path, 'utf8');
  const after = await stat(path);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw new QwenTransferError('QWEN_SOURCE_CHANGED', 'Qwen session changed while it was being exported.');
  }
  return raw;
}

async function readEnvelope(payloadPath: string): Promise<QwenEnvelope> {
  const size = await assertRegularFile(payloadPath);
  if (size < 2 || size > MAX_ENVELOPE_BYTES) {
    throw new QwenTransferError('QWEN_PAYLOAD_INVALID', 'Qwen transfer payload is unavailable or too large.');
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(payloadPath, 'utf8'));
  } catch {
    throw new QwenTransferError('QWEN_PAYLOAD_INVALID', 'Qwen transfer payload is invalid.');
  }
  const parsed = QwenEnvelopeSchema.safeParse(value);
  if (!parsed.success || Buffer.byteLength(parsed.data.nativePayload, 'utf8') > MAX_NATIVE_PAYLOAD_BYTES) {
    throw new QwenTransferError('QWEN_PAYLOAD_INVALID', 'Qwen transfer payload is invalid.');
  }
  const metadata = nativeMetadata(parsed.data.nativePayload);
  if (metadata.nativeSessionId !== parsed.data.nativeSessionId ||
      metadata.workspacePath !== parsed.data.workspacePath ||
      metadata.title !== parsed.data.title) {
    throw new QwenTransferError('QWEN_PAYLOAD_INVALID', 'Qwen payload metadata does not match its native session.');
  }
  return parsed.data;
}

function assertInstallation(installation: ReadyInstallation): void {
  if (installation.provider !== 'qwen') {
    throw new QwenTransferError('QWEN_INSTALLATION_INVALID', 'Qwen transfer requires a Qwen Code installation.');
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('The Qwen transfer was cancelled.');
  error.name = 'AbortError';
  throw error;
}

function destinationSessionPath(
  qwenRoot: string,
  workspacePath: string,
  nativeSessionId: string,
  platform: SystemInfo['platform']
): string {
  return join(
    qwenRoot,
    'projects',
    qwenProjectDirectoryName(workspacePath, platform),
    'chats',
    `${nativeSessionId}.jsonl`
  );
}

function rewriteWorkspace(envelope: QwenEnvelope, destinationWorkspacePath: string): string {
  const metadata = nativeMetadata(envelope.nativePayload);
  let changed = 0;
  const records = metadata.records.map((record) => {
    if (record.cwd !== envelope.workspacePath) return record;
    changed += 1;
    return { ...record, cwd: destinationWorkspacePath };
  });
  if (changed === 0) {
    throw new QwenTransferError('QWEN_PAYLOAD_INVALID', 'Qwen payload has no workspace metadata to update.');
  }
  return records.map((record) => JSON.stringify(record)).join('\n') + '\n';
}

interface CreateQwenTransferAdapterOptions {
  platform: SystemInfo['platform'];
  qwenRoot: string;
  discoverSessions?: (installation: ReadyInstallation) => Promise<ProviderSessionDiscoveryResult>;
  verifiedRoutes?: readonly VerifiedTransferRoute[];
}

export function createQwenTransferAdapter({
  platform,
  qwenRoot,
  discoverSessions = async () => discoverQwenSessions({ qwenRoot }),
  verifiedRoutes = VERIFIED_TRANSFER_ROUTES
}: CreateQwenTransferAdapterOptions): ProviderTransferAdapter {
  const storageRoot = resolve(qwenRoot);
  return {
    provider: 'qwen',
    capabilities(input) {
      const route = verifiedRoutes.some((candidate) =>
        candidate.provider === 'qwen' &&
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
        throw new QwenTransferError('QWEN_SOURCE_INVALID', 'Qwen transfer requires one native session source.');
      }
      const sourcePath = resolve(input.sourceKeys[0]!);
      const expectedProject = qwenProjectDirectoryName(input.expectedWorkspacePath, platform);
      if (!insideRoot(storageRoot, sourcePath) || parse(sourcePath).name !== input.nativeSessionId ||
          !sourcePath.endsWith('.jsonl') || dirname(dirname(sourcePath)).split(/[\\/]/).at(-1) !== expectedProject) {
        throw new QwenTransferError('QWEN_SOURCE_INVALID', 'Qwen session source is outside its expected provider project.');
      }
      const nativePayload = await stableRead(sourcePath, MAX_NATIVE_PAYLOAD_BYTES);
      const metadata = nativeMetadata(nativePayload);
      if (metadata.nativeSessionId !== input.nativeSessionId ||
          metadata.workspacePath !== input.expectedWorkspacePath ||
          metadata.title !== input.expectedTitle) {
        throw new QwenTransferError('QWEN_SOURCE_CHANGED', 'Qwen session changed before export.');
      }
      const envelope: QwenEnvelope = {
        schemaVersion: 1,
        provider: 'qwen',
        nativeSessionId: metadata.nativeSessionId,
        workspacePath: metadata.workspacePath,
        title: metadata.title,
        nativePayload
      };
      const body = JSON.stringify(envelope);
      const payloadPath = join(input.stagingDirectory, 'qwen-session.json');
      await writeFile(payloadPath, body, { encoding: 'utf8', flag: 'wx' });
      return {
        provider: 'qwen', nativeSessionId: metadata.nativeSessionId,
        workspacePath: metadata.workspacePath, title: metadata.title,
        payloadPath, size: Buffer.byteLength(body, 'utf8')
      };
    },
    async inspectImport(input): Promise<ProviderImportInspection> {
      const envelope = await readEnvelope(input.payloadPath);
      return {
        provider: 'qwen', nativeSessionId: envelope.nativeSessionId,
        workspacePath: envelope.workspacePath, title: envelope.title,
        payloadPath: input.payloadPath
      };
    },
    async importSession(input) {
      assertInstallation(input.installation);
      if (!isPortableAbsolutePath(input.destinationWorkspacePath)) {
        throw new QwenTransferError('QWEN_WORKSPACE_PATH_INVALID', 'Qwen import requires an absolute workspace.');
      }
      throwIfAborted(input.signal);
      const envelope = await readEnvelope(input.inspection.payloadPath);
      if (envelope.nativeSessionId !== input.inspection.nativeSessionId ||
          envelope.workspacePath !== input.inspection.workspacePath ||
          envelope.title !== input.inspection.title) {
        throw new QwenTransferError('QWEN_SOURCE_CHANGED', 'Qwen staged payload changed before import.');
      }
      const before = await discoverSessions(input.installation);
      if (before.sessions.some((session) => session.nativeId === envelope.nativeSessionId)) {
        return { status: 'duplicate' as const, nativeSessionId: envelope.nativeSessionId };
      }
      const destinationPath = destinationSessionPath(
        storageRoot,
        input.destinationWorkspacePath,
        envelope.nativeSessionId,
        platform
      );
      await mkdir(dirname(destinationPath), { recursive: true });
      const body = rewriteWorkspace(envelope, input.destinationWorkspacePath);
      try {
        await writeFile(destinationPath, body, { encoding: 'utf8', flag: 'wx' });
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') {
          return { status: 'duplicate' as const, nativeSessionId: envelope.nativeSessionId };
        }
        throw error;
      }
      return { status: 'imported' as const, nativeSessionId: envelope.nativeSessionId, payloadPath: destinationPath };
    },
    async verifyImportedSession(input) {
      assertInstallation(input.installation);
      const discovered = await discoverSessions(input.installation);
      return discovered.sessions.some((session) =>
        session.nativeId === input.nativeSessionId &&
        session.workspacePath === input.workspacePath &&
        session.title === input.title
      );
    },
    async rollbackImport(input) {
      assertInstallation(input.installation);
      if (!isPortableAbsolutePath(input.workspacePath) || !SESSION_ID_PATTERN.test(input.nativeSessionId)) {
        throw new QwenTransferError('QWEN_ROLLBACK_INVALID', 'Qwen rollback identity is invalid.');
      }
      await rm(destinationSessionPath(storageRoot, input.workspacePath, input.nativeSessionId, platform), {
        force: true
      });
    }
  };
}
