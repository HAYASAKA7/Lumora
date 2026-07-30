import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { z } from 'zod';

import type { ProviderInstallation, SystemInfo } from '../../../shared/contracts';
import {
  discoverJsonSessions
} from '../../providers/json-session-source';
import {
  executeStructuredCommand,
  type StructuredCommandInvocation,
  type StructuredCommandOutput,
  type StructuredCommandRunner
} from '../../providers/opencode-session-source';
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

const MAX_NATIVE_PAYLOAD_BYTES = 8 * 1024 * 1024;
const MAX_ENVELOPE_BYTES = 12 * 1024 * 1024;
const MAX_COMMAND_OUTPUT_BYTES = 4 * 1024 * 1024;
const SAFE_NATIVE_ID = /^[A-Za-z0-9._:-]{1,256}$/;

const GeminiEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provider: z.literal('gemini'),
  nativeSessionId: z.string().regex(SAFE_NATIVE_ID),
  workspacePath: z.string().min(1).max(32_768).refine(isPortableAbsolutePath),
  title: z.string().trim().min(1).max(256),
  sourceFormat: z.enum(['json', 'jsonl']),
  nativePayload: z.string().min(2)
});
type GeminiEnvelope = z.infer<typeof GeminiEnvelopeSchema>;

interface GeminiNativeMetadata {
  sessionId: string;
  title: string;
}

export class GeminiTransferError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'GeminiTransferError';
  }
}

interface GeminiTransferInvocationInput {
  operation: 'import' | 'delete';
  executablePath: string;
  payloadPath?: string;
  nativeSessionId?: string;
  workspacePath: string;
  platform: SystemInfo['platform'];
  env: Environment;
}

export type GeminiTransferInvocation = Pick<
  StructuredCommandInvocation,
  'file' | 'args' | 'cwd' | 'shell' | 'windowsHide' | 'windowsVerbatimArguments'
>;

function environmentValue(env: Environment, key: string): string | undefined {
  const matching = Object.keys(env).find(
    (candidate) => candidate.toLocaleLowerCase() === key.toLocaleLowerCase()
  );
  return matching === undefined ? undefined : env[matching];
}

function transferArguments(input: GeminiTransferInvocationInput): readonly string[] {
  if (!isPortableAbsolutePath(input.workspacePath)) {
    throw new GeminiTransferError(
      'GEMINI_WORKSPACE_PATH_INVALID',
      'Gemini transfer requires an absolute destination workspace.'
    );
  }
  if (input.operation === 'import') {
    if (input.payloadPath === undefined || !isPortableAbsolutePath(input.payloadPath)) {
      throw new GeminiTransferError(
        'GEMINI_PAYLOAD_PATH_INVALID',
        'Gemini import requires an absolute staged payload path.'
      );
    }
    return ['--session-file', input.payloadPath, '--list-sessions'];
  }
  if (input.nativeSessionId === undefined || !SAFE_NATIVE_ID.test(input.nativeSessionId)) {
    throw new GeminiTransferError(
      'GEMINI_SESSION_ID_INVALID',
      'Gemini session identity cannot be invoked safely.'
    );
  }
  return ['--delete-session', input.nativeSessionId];
}

export function buildGeminiTransferInvocation(
  input: GeminiTransferInvocationInput
): GeminiTransferInvocation {
  const args = transferArguments(input);
  if (input.platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(input.executablePath)) {
    return {
      file: input.executablePath,
      args,
      cwd: input.workspacePath,
      shell: false,
      windowsHide: true
    };
  }
  if (/["%\r\n]/.test(input.executablePath) || args.some((argument) => /["%\r\n]/.test(argument))) {
    throw new GeminiTransferError(
      'GEMINI_ARGUMENT_UNSAFE',
      'Gemini transfer command cannot be invoked safely.'
    );
  }
  const command = [
    `"${input.executablePath}"`,
    ...args.map((argument) => /\s/.test(argument) ? `"${argument}"` : argument)
  ].join(' ');
  return {
    file: environmentValue(input.env, 'ComSpec')?.trim() || 'cmd.exe',
    args: ['/d', '/s', '/c', `"${command}"`],
    cwd: input.workspacePath,
    shell: false,
    windowsHide: true,
    windowsVerbatimArguments: true
  };
}

function titleFrom(record: Record<string, unknown>): string {
  for (const field of ['summary', 'title']) {
    const value = record[field];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim().slice(0, 256);
    }
  }
  return 'Untitled session';
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseJsonLines(raw: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new GeminiTransferError('GEMINI_PAYLOAD_INVALID', 'Gemini session JSONL is invalid.');
    }
    const record = objectRecord(value);
    if (record === null) {
      throw new GeminiTransferError('GEMINI_PAYLOAD_INVALID', 'Gemini session JSONL is invalid.');
    }
    records.push(record);
  }
  return records;
}

function parseNativeMetadata(raw: string, format: GeminiEnvelope['sourceFormat']): GeminiNativeMetadata {
  let metadata: Record<string, unknown> | null = null;
  if (format === 'jsonl') {
    metadata = parseJsonLines(raw).find(
      (record) => typeof record.sessionId === 'string'
    ) ?? null;
  } else {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new GeminiTransferError('GEMINI_PAYLOAD_INVALID', 'Gemini session JSON is invalid.');
    }
    metadata = objectRecord(value);
  }
  if (metadata === null || typeof metadata.sessionId !== 'string' ||
      !SAFE_NATIVE_ID.test(metadata.sessionId)) {
    throw new GeminiTransferError('GEMINI_PAYLOAD_INVALID', 'Gemini session metadata is invalid.');
  }
  return { sessionId: metadata.sessionId, title: titleFrom(metadata) };
}

function assertInstallation(installation: ReadyInstallation): void {
  if (installation.provider !== 'gemini') {
    throw new GeminiTransferError(
      'GEMINI_INSTALLATION_INVALID',
      'Gemini transfer requires a Gemini CLI installation.'
    );
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('The Gemini transfer was cancelled.');
  error.name = 'AbortError';
  throw error;
}

function assertCommandOutput(output: StructuredCommandOutput): void {
  if (output.timedOut) {
    throw new GeminiTransferError('GEMINI_COMMAND_TIMEOUT', 'Gemini transfer command timed out.');
  }
  if (output.outputTruncated || Buffer.byteLength(output.stdout, 'utf8') > MAX_COMMAND_OUTPUT_BYTES) {
    throw new GeminiTransferError('GEMINI_OUTPUT_LIMIT', 'Gemini transfer command exceeded its output limit.');
  }
  if (output.exitCode !== 0) {
    throw new GeminiTransferError('GEMINI_COMMAND_FAILED', 'Gemini transfer command failed.');
  }
}

function insideRoot(root: string, candidate: string): boolean {
  const value = relative(resolve(root), resolve(candidate));
  return value.length > 0 && !value.startsWith('..') && !isAbsolute(value);
}

async function stableRead(path: string, maxBytes: number): Promise<string> {
  const before = await stat(path);
  if (!before.isFile() || before.size < 2 || before.size > maxBytes) {
    throw new GeminiTransferError('GEMINI_SOURCE_INVALID', 'Gemini session source is unavailable or too large.');
  }
  const raw = await readFile(path, 'utf8');
  const after = await stat(path);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw new GeminiTransferError('GEMINI_SOURCE_CHANGED', 'Gemini session changed while it was being exported.');
  }
  return raw;
}

function markerFileName(nativeSessionId: string, format: GeminiEnvelope['sourceFormat']): string {
  const digest = createHash('sha256').update(nativeSessionId).digest('hex');
  return `lumora-transfer-${digest}.${format}`;
}

function providerBasename(path: string): string {
  return path.replaceAll('\\', '/').split('/').at(-1) ?? '';
}

async function hasImportMarker(sourcePath: string, marker: string): Promise<boolean> {
  try {
    const raw = await stableRead(sourcePath, MAX_NATIVE_PAYLOAD_BYTES);
    return parseJsonLines(raw).some((record) => {
      if (record.type !== 'info' || typeof record.content !== 'string') return false;
      const prefix = 'Imported session from ';
      return record.content.startsWith(prefix) &&
        providerBasename(record.content.slice(prefix.length)) === marker;
    });
  } catch {
    return false;
  }
}

async function importedByMarker(
  result: ProviderSessionDiscoveryResult,
  marker: string,
  workspacePath: string,
  storageRoot: string
): Promise<ProviderSessionRecord | null> {
  for (const session of result.sessions) {
    if (session.provider !== 'gemini' || session.workspacePath !== workspacePath ||
        !insideRoot(storageRoot, session.source.key)) continue;
    if (await hasImportMarker(session.source.key, marker)) return session;
  }
  return null;
}

async function readEnvelope(payloadPath: string): Promise<GeminiEnvelope> {
  const size = await assertRegularFile(payloadPath);
  if (size < 2 || size > MAX_ENVELOPE_BYTES) {
    throw new GeminiTransferError('GEMINI_PAYLOAD_INVALID', 'Gemini transfer payload is unavailable or too large.');
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(payloadPath, 'utf8'));
  } catch {
    throw new GeminiTransferError('GEMINI_PAYLOAD_INVALID', 'Gemini transfer payload is invalid.');
  }
  const parsed = GeminiEnvelopeSchema.safeParse(value);
  if (!parsed.success || Buffer.byteLength(parsed.data.nativePayload, 'utf8') > MAX_NATIVE_PAYLOAD_BYTES) {
    throw new GeminiTransferError('GEMINI_PAYLOAD_INVALID', 'Gemini transfer payload is invalid.');
  }
  const metadata = parseNativeMetadata(parsed.data.nativePayload, parsed.data.sourceFormat);
  if (metadata.sessionId !== parsed.data.nativeSessionId || metadata.title !== parsed.data.title) {
    throw new GeminiTransferError('GEMINI_PAYLOAD_INVALID', 'Gemini payload metadata does not match its native session.');
  }
  return parsed.data;
}

interface CreateGeminiTransferAdapterOptions {
  platform: SystemInfo['platform'];
  env: Environment;
  geminiStorageRoot: string;
  runCommand?: StructuredCommandRunner;
  discoverSessions?: (installation: ReadyInstallation) => Promise<ProviderSessionDiscoveryResult>;
  verifiedRoutes?: readonly VerifiedTransferRoute[];
  timeoutMs?: number;
}

export function createGeminiTransferAdapter({
  platform,
  env,
  geminiStorageRoot,
  runCommand = executeStructuredCommand,
  discoverSessions = async () => discoverJsonSessions({
    provider: 'gemini',
    storageRoot: geminiStorageRoot
  }),
  verifiedRoutes = VERIFIED_TRANSFER_ROUTES,
  timeoutMs = 30_000
}: CreateGeminiTransferAdapterOptions): ProviderTransferAdapter {
  const storageRoot = resolve(geminiStorageRoot);
  const run = async (
    installation: ReadyInstallation,
    invocation: GeminiTransferInvocation
  ): Promise<StructuredCommandOutput> => {
    const output = await runCommand({
      ...invocation,
      env: { ...env, NO_COLOR: '1' },
      timeoutMs,
      maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES
    });
    assertCommandOutput(output);
    return output;
  };

  return {
    provider: 'gemini',
    capabilities(input) {
      const route = verifiedRoutes.some((candidate) =>
        candidate.provider === 'gemini' &&
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
        throw new GeminiTransferError('GEMINI_SOURCE_INVALID', 'Gemini transfer requires one native session source.');
      }
      const sourcePath = resolve(input.sourceKeys[0]!);
      if (!insideRoot(storageRoot, sourcePath) || !/\.jsonl?$/i.test(sourcePath)) {
        throw new GeminiTransferError('GEMINI_SOURCE_INVALID', 'Gemini session source is outside provider storage.');
      }
      const projectDirectory = dirname(dirname(sourcePath));
      const projectRoot = (await stableRead(join(projectDirectory, '.project_root'), 32_768)).trim();
      if (projectRoot !== input.expectedWorkspacePath) {
        throw new GeminiTransferError('GEMINI_SOURCE_CHANGED', 'Gemini workspace changed before export.');
      }
      const sourceFormat: GeminiEnvelope['sourceFormat'] = sourcePath.endsWith('.jsonl') ? 'jsonl' : 'json';
      const nativePayload = await stableRead(sourcePath, MAX_NATIVE_PAYLOAD_BYTES);
      const metadata = parseNativeMetadata(nativePayload, sourceFormat);
      if (metadata.sessionId !== input.nativeSessionId || metadata.title !== input.expectedTitle) {
        throw new GeminiTransferError('GEMINI_SOURCE_CHANGED', 'Gemini session changed before export.');
      }
      const envelope: GeminiEnvelope = {
        schemaVersion: 1,
        provider: 'gemini',
        nativeSessionId: metadata.sessionId,
        workspacePath: projectRoot,
        title: metadata.title,
        sourceFormat,
        nativePayload
      };
      const body = JSON.stringify(envelope);
      const payloadPath = join(input.stagingDirectory, 'gemini-session.json');
      await writeFile(payloadPath, body, { encoding: 'utf8', flag: 'wx' });
      return {
        provider: 'gemini',
        nativeSessionId: metadata.sessionId,
        workspacePath: projectRoot,
        title: metadata.title,
        payloadPath,
        size: Buffer.byteLength(body, 'utf8')
      };
    },
    async inspectImport(input): Promise<ProviderImportInspection> {
      const envelope = await readEnvelope(input.payloadPath);
      return {
        provider: 'gemini',
        nativeSessionId: envelope.nativeSessionId,
        workspacePath: envelope.workspacePath,
        title: envelope.title,
        payloadPath: input.payloadPath
      };
    },
    async importSession(input) {
      assertInstallation(input.installation);
      if (!isPortableAbsolutePath(input.destinationWorkspacePath)) {
        throw new GeminiTransferError('GEMINI_WORKSPACE_PATH_INVALID', 'Gemini import requires an absolute workspace.');
      }
      throwIfAborted(input.signal);
      const envelope = await readEnvelope(input.inspection.payloadPath);
      if (envelope.nativeSessionId !== input.inspection.nativeSessionId ||
          envelope.workspacePath !== input.inspection.workspacePath ||
          envelope.title !== input.inspection.title) {
        throw new GeminiTransferError('GEMINI_SOURCE_CHANGED', 'Gemini staged payload changed before import.');
      }
      const marker = markerFileName(envelope.nativeSessionId, envelope.sourceFormat);
      const before = await discoverSessions(input.installation);
      const sameNativeId = before.sessions.find((session) => session.nativeId === envelope.nativeSessionId);
      if (sameNativeId !== undefined) {
        return { status: 'duplicate' as const, nativeSessionId: sameNativeId.nativeId };
      }
      const previousImport = await importedByMarker(before, marker, input.destinationWorkspacePath, storageRoot);
      if (previousImport !== null) {
        return { status: 'duplicate' as const, nativeSessionId: previousImport.nativeId };
      }
      const nativePayloadPath = join(input.stagingDirectory, marker);
      await writeFile(nativePayloadPath, envelope.nativePayload, { encoding: 'utf8', flag: 'wx' });
      await run(input.installation, buildGeminiTransferInvocation({
        operation: 'import',
        executablePath: input.installation.executablePath,
        payloadPath: nativePayloadPath,
        workspacePath: input.destinationWorkspacePath,
        platform,
        env
      }));
      const after = await discoverSessions(input.installation);
      const imported = await importedByMarker(after, marker, input.destinationWorkspacePath, storageRoot);
      if (imported === null) {
        throw new GeminiTransferError('GEMINI_IMPORT_RESULT_INVALID', 'Gemini did not expose the imported session.');
      }
      return { status: 'imported' as const, nativeSessionId: imported.nativeId, payloadPath: nativePayloadPath };
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
      await run(input.installation, buildGeminiTransferInvocation({
        operation: 'delete',
        executablePath: input.installation.executablePath,
        nativeSessionId: input.nativeSessionId,
        workspacePath: input.workspacePath,
        platform,
        env
      }));
    }
  };
}
