import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { z } from 'zod';

import type { ProviderInstallation } from '../../../shared/contracts';
import { discoverCopilotSessions } from '../../providers/copilot-session-source';
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

type Environment = Readonly<Record<string, string | undefined>>;
type ReadyInstallation = Extract<ProviderInstallation, { state: 'ready' }>;

const MAX_FILE_COUNT = 5_000;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_ENVELOPE_BYTES = 384 * 1024 * 1024;
const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CopilotFileSchema = z.strictObject({
  path: z.string().min(1).max(4_096),
  size: z.number().int().nonnegative().max(MAX_TOTAL_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  contentBase64: z.string()
});
const CopilotEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provider: z.literal('copilot'),
  nativeSessionId: z.string().regex(SESSION_ID_PATTERN),
  workspacePath: z.string().min(1).max(32_768).refine(isPortableAbsolutePath),
  title: z.string().trim().min(1).max(256),
  files: z.array(CopilotFileSchema).min(1).max(MAX_FILE_COUNT)
});
type CopilotEnvelope = z.infer<typeof CopilotEnvelopeSchema>;
type CopilotFile = CopilotEnvelope['files'][number];

export class CopilotTransferError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'CopilotTransferError';
  }
}

interface CreateCopilotTransferAdapterOptions {
  configRoot: string;
  homeDirectory?: string;
  env?: Environment;
  discoverSessions?: (installation: ReadyInstallation) => Promise<ProviderSessionDiscoveryResult>;
  verifiedRoutes?: readonly VerifiedTransferRoute[];
}

function insideRoot(root: string, candidate: string): boolean {
  const value = relative(resolve(root), resolve(candidate));
  return value.length > 0 && !value.startsWith('..') && !isAbsolute(value);
}

function safeRelativePath(path: string): boolean {
  if (path.includes('\\') || path.includes('\0') || path.startsWith('/')) return false;
  const segments = path.split('/');
  return segments.length > 0 && segments.every((segment) =>
    segment.length > 0 && segment !== '.' && segment !== '..' && !segment.includes(':')
  );
}

async function stableRead(path: string, maxBytes: number): Promise<Buffer> {
  const before = await stat(path);
  if (!before.isFile() || before.size < 1 || before.size > maxBytes) {
    throw new CopilotTransferError('COPILOT_SOURCE_INVALID', 'Copilot session file is unavailable or too large.');
  }
  const body = await readFile(path);
  const after = await stat(path);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw new CopilotTransferError('COPILOT_SOURCE_CHANGED', 'Copilot session changed while it was being exported.');
  }
  return body;
}

function encodedFile(path: string, body: Buffer): CopilotFile {
  return {
    path,
    size: body.length,
    sha256: createHash('sha256').update(body).digest('hex'),
    contentBase64: body.toString('base64')
  };
}

function decodeFile(file: CopilotFile): Buffer {
  if (!safeRelativePath(file.path)) {
    throw new CopilotTransferError('COPILOT_PAYLOAD_INVALID', 'Copilot transfer contains an unsafe file path.');
  }
  const body = Buffer.from(file.contentBase64, 'base64');
  if (body.length !== file.size || body.toString('base64') !== file.contentBase64 ||
      createHash('sha256').update(body).digest('hex') !== file.sha256) {
    throw new CopilotTransferError('COPILOT_PAYLOAD_INVALID', 'Copilot transfer file integrity is invalid.');
  }
  return body;
}

async function enumerateSessionFiles(sessionRoot: string): Promise<CopilotFile[]> {
  const files: CopilotFile[] = [];
  const pending: Array<{ absolute: string; relative: string }> = [
    { absolute: sessionRoot, relative: '' }
  ];
  let totalBytes = 0;
  while (pending.length > 0) {
    const current = pending.shift()!;
    const entries = await readdir(current.absolute, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) {
        throw new CopilotTransferError('COPILOT_SOURCE_INVALID', 'Copilot session contains an unsafe entry.');
      }
      const relativePath = current.relative.length === 0
        ? entry.name
        : `${current.relative}/${entry.name}`;
      const absolutePath = join(current.absolute, entry.name);
      if (entry.isDirectory()) {
        pending.push({ absolute: absolutePath, relative: relativePath });
        continue;
      }
      if (files.length >= MAX_FILE_COUNT) {
        throw new CopilotTransferError('COPILOT_SOURCE_LIMIT', 'Copilot session contains too many files.');
      }
      const body = await stableRead(absolutePath, MAX_TOTAL_BYTES);
      totalBytes += body.length;
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new CopilotTransferError('COPILOT_SOURCE_LIMIT', 'Copilot session is too large.');
      }
      files.push(encodedFile(relativePath, body));
    }
  }
  return files;
}

function yamlFields(raw: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (match !== null) fields.set(match[1]!, match[2]!.trim());
  }
  return fields;
}

function validateWorkspaceMetadata(
  body: Buffer,
  nativeSessionId: string,
  workspacePath: string
): void {
  const fields = yamlFields(body.toString('utf8'));
  if (fields.get('id') !== nativeSessionId || fields.get('cwd') !== workspacePath) {
    throw new CopilotTransferError('COPILOT_PAYLOAD_INVALID', 'Copilot workspace metadata is inconsistent.');
  }
}

function validateEnvelope(value: unknown): CopilotEnvelope {
  const parsed = CopilotEnvelopeSchema.safeParse(value);
  if (!parsed.success) {
    throw new CopilotTransferError('COPILOT_PAYLOAD_INVALID', 'Copilot transfer payload is invalid.');
  }
  const paths = new Set<string>();
  let totalBytes = 0;
  for (const file of parsed.data.files) {
    if (paths.has(file.path)) {
      throw new CopilotTransferError('COPILOT_PAYLOAD_INVALID', 'Copilot transfer contains duplicate files.');
    }
    paths.add(file.path);
    totalBytes += decodeFile(file).length;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new CopilotTransferError('COPILOT_PAYLOAD_INVALID', 'Copilot transfer is too large.');
    }
  }
  const workspace = parsed.data.files.find((file) => file.path === 'workspace.yaml');
  if (workspace === undefined) {
    throw new CopilotTransferError('COPILOT_PAYLOAD_INVALID', 'Copilot transfer is missing workspace metadata.');
  }
  validateWorkspaceMetadata(
    decodeFile(workspace),
    parsed.data.nativeSessionId,
    parsed.data.workspacePath
  );
  return parsed.data;
}

async function readEnvelope(payloadPath: string): Promise<CopilotEnvelope> {
  const size = await assertRegularFile(payloadPath);
  if (size < 2 || size > MAX_ENVELOPE_BYTES) {
    throw new CopilotTransferError('COPILOT_PAYLOAD_INVALID', 'Copilot transfer payload is unavailable or too large.');
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(payloadPath, 'utf8'));
  } catch {
    throw new CopilotTransferError('COPILOT_PAYLOAD_INVALID', 'Copilot transfer payload is invalid.');
  }
  return validateEnvelope(value);
}

function rewriteWorkspaceYaml(
  body: Buffer,
  sourceWorkspacePath: string,
  destinationWorkspacePath: string
): Buffer {
  let changed = false;
  const rewritten = body.toString('utf8').split(/\r?\n/).map((line) => {
    const match = /^(cwd|git_root):\s*(.*)$/.exec(line);
    if (match === null || match[2]!.trim() !== sourceWorkspacePath) return line;
    if (match[1] === 'cwd') changed = true;
    return `${match[1]}: ${destinationWorkspacePath}`;
  });
  if (!changed) {
    throw new CopilotTransferError('COPILOT_PAYLOAD_INVALID', 'Copilot workspace path could not be mapped.');
  }
  return Buffer.from(rewritten.join('\n'));
}

const WORKSPACE_FIELDS = new Set(['cwd', 'workingDirectory', 'workspacePath', 'gitRoot', 'git_root']);

function rewriteJsonValue(
  value: unknown,
  sourceWorkspacePath: string,
  destinationWorkspacePath: string
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => rewriteJsonValue(item, sourceWorkspacePath, destinationWorkspacePath));
  }
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    WORKSPACE_FIELDS.has(key) && child === sourceWorkspacePath
      ? destinationWorkspacePath
      : rewriteJsonValue(child, sourceWorkspacePath, destinationWorkspacePath)
  ]));
}

function rewriteJsonl(
  body: Buffer,
  sourceWorkspacePath: string,
  destinationWorkspacePath: string
): Buffer {
  const lines: string[] = [];
  for (const line of body.toString('utf8').split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new CopilotTransferError('COPILOT_PAYLOAD_INVALID', 'Copilot event history is invalid.');
    }
    lines.push(JSON.stringify(rewriteJsonValue(value, sourceWorkspacePath, destinationWorkspacePath)));
  }
  return Buffer.from(lines.join('\n') + '\n');
}

function assertInstallation(installation: ReadyInstallation): void {
  if (installation.provider !== 'copilot') {
    throw new CopilotTransferError('COPILOT_INSTALLATION_INVALID', 'Copilot transfer requires GitHub Copilot CLI.');
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('The Copilot transfer was cancelled.');
  error.name = 'AbortError';
  throw error;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

export function createCopilotTransferAdapter({
  configRoot,
  homeDirectory = dirname(resolve(configRoot)),
  env = {},
  discoverSessions = async () => discoverCopilotSessions({ homeDirectory, env }),
  verifiedRoutes = VERIFIED_TRANSFER_ROUTES
}: CreateCopilotTransferAdapterOptions): ProviderTransferAdapter {
  const providerRoot = resolve(configRoot);
  const sessionStateRoot = join(providerRoot, 'session-state');
  return {
    provider: 'copilot',
    capabilities(input) {
      const route = verifiedRoutes.some((candidate) =>
        candidate.provider === 'copilot' &&
        candidate.sourcePlatform === input.sourcePlatform &&
        candidate.destinationPlatform === input.destinationPlatform &&
        candidate.providerVersion === input.providerVersion
      );
      return { export: route, import: route };
    },
    async exportSession(input): Promise<ProviderExportPayload> {
      assertInstallation(input.installation);
      throwIfAborted(input.signal);
      if (input.sourceKeys.length !== 1 || !SESSION_ID_PATTERN.test(input.nativeSessionId)) {
        throw new CopilotTransferError('COPILOT_SOURCE_INVALID', 'Copilot transfer requires one native session source.');
      }
      const sourcePath = resolve(input.sourceKeys[0]!);
      const sessionRoot = dirname(sourcePath);
      if (!insideRoot(sessionStateRoot, sourcePath) || basename(sessionRoot) !== input.nativeSessionId ||
          !['events.jsonl', 'workspace.yaml'].includes(basename(sourcePath))) {
        throw new CopilotTransferError('COPILOT_SOURCE_INVALID', 'Copilot source is outside its native session directory.');
      }
      const files = await enumerateSessionFiles(sessionRoot);
      const workspace = files.find((file) => file.path === 'workspace.yaml');
      if (workspace === undefined) {
        throw new CopilotTransferError('COPILOT_SOURCE_INVALID', 'Copilot session has no workspace metadata.');
      }
      validateWorkspaceMetadata(
        decodeFile(workspace),
        input.nativeSessionId,
        input.expectedWorkspacePath
      );
      const envelope: CopilotEnvelope = {
        schemaVersion: 1,
        provider: 'copilot',
        nativeSessionId: input.nativeSessionId,
        workspacePath: input.expectedWorkspacePath,
        title: input.expectedTitle,
        files
      };
      const body = JSON.stringify(envelope);
      if (Buffer.byteLength(body, 'utf8') > MAX_ENVELOPE_BYTES) {
        throw new CopilotTransferError('COPILOT_SOURCE_LIMIT', 'Copilot session bundle is too large.');
      }
      const payloadPath = join(input.stagingDirectory, 'copilot-session.json');
      await writeFile(payloadPath, body, { encoding: 'utf8', flag: 'wx' });
      return {
        provider: 'copilot', nativeSessionId: envelope.nativeSessionId,
        workspacePath: envelope.workspacePath, title: envelope.title,
        payloadPath, size: Buffer.byteLength(body, 'utf8')
      };
    },
    async inspectImport(input): Promise<ProviderImportInspection> {
      const envelope = await readEnvelope(input.payloadPath);
      return {
        provider: 'copilot', nativeSessionId: envelope.nativeSessionId,
        workspacePath: envelope.workspacePath, title: envelope.title,
        payloadPath: input.payloadPath
      };
    },
    async importSession(input) {
      assertInstallation(input.installation);
      if (!isPortableAbsolutePath(input.destinationWorkspacePath)) {
        throw new CopilotTransferError('COPILOT_WORKSPACE_PATH_INVALID', 'Copilot import requires an absolute workspace.');
      }
      throwIfAborted(input.signal);
      const envelope = await readEnvelope(input.inspection.payloadPath);
      if (envelope.nativeSessionId !== input.inspection.nativeSessionId ||
          envelope.workspacePath !== input.inspection.workspacePath ||
          envelope.title !== input.inspection.title) {
        throw new CopilotTransferError('COPILOT_SOURCE_CHANGED', 'Copilot staged payload changed before import.');
      }
      const before = await discoverSessions(input.installation);
      if (before.sessions.some((session) => session.nativeId === envelope.nativeSessionId)) {
        return { status: 'duplicate' as const, nativeSessionId: envelope.nativeSessionId };
      }
      const destinationRoot = join(sessionStateRoot, envelope.nativeSessionId);
      if (await exists(destinationRoot)) {
        return { status: 'duplicate' as const, nativeSessionId: envelope.nativeSessionId };
      }
      await mkdir(sessionStateRoot, { recursive: true });
      try {
        await mkdir(destinationRoot);
        for (const file of envelope.files) {
          throwIfAborted(input.signal);
          const target = join(destinationRoot, ...file.path.split('/'));
          await mkdir(dirname(target), { recursive: true });
          const decoded = decodeFile(file);
          const body = file.path === 'workspace.yaml'
            ? rewriteWorkspaceYaml(decoded, envelope.workspacePath, input.destinationWorkspacePath)
            : file.path.endsWith('.jsonl')
              ? rewriteJsonl(decoded, envelope.workspacePath, input.destinationWorkspacePath)
              : decoded;
          await writeFile(target, body, { flag: 'wx' });
        }
      } catch (error) {
        await rm(destinationRoot, { recursive: true, force: true }).catch(() => undefined);
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') {
          return { status: 'duplicate' as const, nativeSessionId: envelope.nativeSessionId };
        }
        throw error;
      }
      const eventsPath = join(destinationRoot, 'events.jsonl');
      return {
        status: 'imported' as const,
        nativeSessionId: envelope.nativeSessionId,
        payloadPath: await exists(eventsPath) ? eventsPath : join(destinationRoot, 'workspace.yaml')
      };
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
      if (!SESSION_ID_PATTERN.test(input.nativeSessionId)) {
        throw new CopilotTransferError('COPILOT_ROLLBACK_INVALID', 'Copilot rollback identity is invalid.');
      }
      await rm(join(sessionStateRoot, input.nativeSessionId), { recursive: true, force: true });
    }
  };
}
