import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import {
  dirname,
  isAbsolute,
  join,
  parse,
  posix,
  relative,
  resolve,
  win32
} from 'node:path';

import { z } from 'zod';

import type { ProviderInstallation } from '../../../shared/contracts';
import { discoverClaudeSessions } from '../../providers/claude-session-source';
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

const ClaudeFileSchema = z.strictObject({
  path: z.string().min(1).max(4_096),
  size: z.number().int().nonnegative().max(MAX_TOTAL_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  contentBase64: z.string()
});
const ClaudeEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provider: z.literal('claude'),
  nativeSessionId: z.string().regex(SESSION_ID_PATTERN),
  workspacePath: z.string().min(1).max(32_768).refine(isPortableAbsolutePath),
  title: z.string().trim().min(1).max(256),
  files: z.array(ClaudeFileSchema).min(1).max(MAX_FILE_COUNT)
});
type ClaudeEnvelope = z.infer<typeof ClaudeEnvelopeSchema>;
type ClaudeFile = ClaudeEnvelope['files'][number];

interface ClaudeNativeMetadata {
  nativeSessionId: string;
  workspacePaths: readonly string[];
  title: string;
}

export class ClaudeTransferError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ClaudeTransferError';
  }
}

export function claudeProjectDirectoryName(workspacePath: string): string {
  return workspacePath.replace(/[^a-zA-Z0-9]/g, '-');
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseJsonl(raw: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new ClaudeTransferError('CLAUDE_PAYLOAD_INVALID', 'Claude session JSONL is invalid.');
    }
    const record = objectRecord(value);
    if (record === null) {
      throw new ClaudeTransferError('CLAUDE_PAYLOAD_INVALID', 'Claude session JSONL is invalid.');
    }
    records.push(record);
  }
  if (records.length === 0) {
    throw new ClaudeTransferError('CLAUDE_PAYLOAD_INVALID', 'Claude session JSONL is empty.');
  }
  return records;
}

function explicitTitle(record: Record<string, unknown>): string | null {
  for (const field of ['customTitle', 'aiTitle', 'sessionName']) {
    const value = record[field];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim().slice(0, 256);
    }
  }
  return null;
}

function nativeMetadata(raw: string): ClaudeNativeMetadata {
  const records = parseJsonl(raw);
  const nativeIds = new Set(records.flatMap((record) =>
    typeof record.sessionId === 'string' && record.sessionId.trim().length > 0
      ? [record.sessionId.trim()]
      : []
  ));
  const workspacePaths = new Set(records.flatMap((record) =>
    typeof record.cwd === 'string' && isPortableAbsolutePath(record.cwd.trim())
      ? [record.cwd.trim()]
      : []
  ));
  if (nativeIds.size !== 1 || workspacePaths.size === 0) {
    throw new ClaudeTransferError('CLAUDE_PAYLOAD_INVALID', 'Claude session metadata is inconsistent.');
  }
  const nativeSessionId = [...nativeIds][0]!;
  if (!SESSION_ID_PATTERN.test(nativeSessionId)) {
    throw new ClaudeTransferError('CLAUDE_PAYLOAD_INVALID', 'Claude session identity is invalid.');
  }
  let title = 'Untitled session';
  for (const record of records) title = explicitTitle(record) ?? title;
  return {
    nativeSessionId,
    workspacePaths: [...workspacePaths],
    title
  };
}

function portablePathApi(value: string): typeof win32 | typeof posix {
  return posix.isAbsolute(value) ? posix : win32;
}

function relativeToWorkspace(workspacePath: string, candidatePath: string): string | null {
  const api = portablePathApi(workspacePath);
  if (portablePathApi(candidatePath) !== api) return null;
  const value = api.relative(api.normalize(workspacePath), api.normalize(candidatePath));
  if (value.length === 0) return '';
  if (value === '..' || value.startsWith(`..${api.sep}`) || api.isAbsolute(value)) return null;
  return value;
}

function sameWorkspacePath(left: string, right: string): boolean {
  return relativeToWorkspace(left, right) === '';
}

function sameProjectDirectory(
  actual: string,
  expected: string,
  workspacePath: string
): boolean {
  return portablePathApi(workspacePath) === win32
    ? actual.toLocaleLowerCase('en-US') === expected.toLocaleLowerCase('en-US')
    : actual === expected;
}

function mappedWorkspacePath(
  candidatePath: string,
  sourceWorkspacePath: string,
  destinationWorkspacePath: string
): string | null {
  const relativePath = relativeToWorkspace(sourceWorkspacePath, candidatePath);
  if (relativePath === null) return null;
  if (relativePath.length === 0) return destinationWorkspacePath;
  const segments = relativePath.split(/[\\/]/).filter((segment) => segment.length > 0);
  return portablePathApi(destinationWorkspacePath).join(destinationWorkspacePath, ...segments);
}

function insideRoot(root: string, candidate: string): boolean {
  const value = relative(resolve(root), resolve(candidate));
  return value.length > 0 && !value.startsWith('..') && !isAbsolute(value);
}

async function stableRead(path: string, maxBytes: number): Promise<Buffer> {
  const before = await stat(path);
  if (!before.isFile() || before.size < 1 || before.size > maxBytes) {
    throw new ClaudeTransferError('CLAUDE_SOURCE_INVALID', 'Claude session source is unavailable or too large.');
  }
  const body = await readFile(path);
  const after = await stat(path);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw new ClaudeTransferError('CLAUDE_SOURCE_CHANGED', 'Claude session changed while it was being exported.');
  }
  return body;
}

function archivePath(relativePath: string): string {
  return `session/${relativePath.split(/[\\/]/).join('/')}`;
}

function safeArchivePath(path: string): boolean {
  if (path === 'session.jsonl') return true;
  if (!path.startsWith('session/') || path.includes('\\') || path.includes('\0')) return false;
  const segments = path.split('/');
  return segments.length > 1 && segments.every((segment) =>
    segment.length > 0 && segment !== '.' && segment !== '..' && !segment.includes(':')
  );
}

function encodedFile(path: string, body: Buffer): ClaudeFile {
  return {
    path,
    size: body.length,
    sha256: createHash('sha256').update(body).digest('hex'),
    contentBase64: body.toString('base64')
  };
}

async function enumerateCompanion(root: string): Promise<ClaudeFile[]> {
  const files: ClaudeFile[] = [];
  const pending: { absolute: string; relative: string }[] = [{ absolute: root, relative: '' }];
  let totalBytes = 0;
  while (pending.length > 0) {
    const directory = pending.shift()!;
    const entries = await readdir(directory.absolute, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
        throw new ClaudeTransferError('CLAUDE_SOURCE_INVALID', 'Claude session companion contains an unsafe entry.');
      }
      const childRelative = directory.relative.length === 0
        ? entry.name
        : join(directory.relative, entry.name);
      const childAbsolute = join(directory.absolute, entry.name);
      if (entry.isDirectory()) {
        pending.push({ absolute: childAbsolute, relative: childRelative });
        continue;
      }
      if (files.length >= MAX_FILE_COUNT - 1) {
        throw new ClaudeTransferError('CLAUDE_SOURCE_LIMIT', 'Claude session companion contains too many files.');
      }
      const body = await stableRead(childAbsolute, MAX_TOTAL_BYTES);
      totalBytes += body.length;
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new ClaudeTransferError('CLAUDE_SOURCE_LIMIT', 'Claude session companion is too large.');
      }
      files.push(encodedFile(archivePath(childRelative), body));
    }
  }
  return files;
}

function decodeFile(file: ClaudeFile): Buffer {
  if (!safeArchivePath(file.path)) {
    throw new ClaudeTransferError('CLAUDE_PAYLOAD_INVALID', 'Claude transfer contains an unsafe file path.');
  }
  const body = Buffer.from(file.contentBase64, 'base64');
  if (body.length !== file.size || body.toString('base64') !== file.contentBase64 ||
      createHash('sha256').update(body).digest('hex') !== file.sha256) {
    throw new ClaudeTransferError('CLAUDE_PAYLOAD_INVALID', 'Claude transfer file integrity is invalid.');
  }
  return body;
}

function validateEnvelope(value: unknown): ClaudeEnvelope {
  const parsed = ClaudeEnvelopeSchema.safeParse(value);
  if (!parsed.success) {
    throw new ClaudeTransferError('CLAUDE_PAYLOAD_INVALID', 'Claude transfer payload is invalid.');
  }
  const paths = new Set<string>();
  let totalBytes = 0;
  for (const file of parsed.data.files) {
    if (paths.has(file.path)) {
      throw new ClaudeTransferError('CLAUDE_PAYLOAD_INVALID', 'Claude transfer contains duplicate files.');
    }
    paths.add(file.path);
    totalBytes += decodeFile(file).length;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new ClaudeTransferError('CLAUDE_PAYLOAD_INVALID', 'Claude transfer payload is too large.');
    }
  }
  if (!paths.has('session.jsonl')) {
    throw new ClaudeTransferError('CLAUDE_PAYLOAD_INVALID', 'Claude transfer is missing its transcript.');
  }
  const main = decodeFile(parsed.data.files.find((file) => file.path === 'session.jsonl')!);
  const metadata = nativeMetadata(main.toString('utf8'));
  if (metadata.nativeSessionId !== parsed.data.nativeSessionId ||
      !metadata.workspacePaths.some((path) => sameWorkspacePath(parsed.data.workspacePath, path)) ||
      metadata.title !== parsed.data.title) {
    throw new ClaudeTransferError('CLAUDE_PAYLOAD_INVALID', 'Claude payload metadata does not match its transcript.');
  }
  return parsed.data;
}

async function readEnvelope(payloadPath: string): Promise<ClaudeEnvelope> {
  const size = await assertRegularFile(payloadPath);
  if (size < 2 || size > MAX_ENVELOPE_BYTES) {
    throw new ClaudeTransferError('CLAUDE_PAYLOAD_INVALID', 'Claude transfer payload is unavailable or too large.');
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(payloadPath, 'utf8'));
  } catch {
    throw new ClaudeTransferError('CLAUDE_PAYLOAD_INVALID', 'Claude transfer payload is invalid.');
  }
  return validateEnvelope(value);
}

function rewriteJsonl(
  body: Buffer,
  sourceWorkspacePath: string,
  destinationWorkspacePath: string,
  required: boolean
): Buffer {
  let records: Record<string, unknown>[];
  try {
    records = parseJsonl(body.toString('utf8'));
  } catch (error) {
    if (!required) return body;
    throw error;
  }
  let changed = 0;
  const rewritten = records.map((record) => {
    if (typeof record.cwd !== 'string') return record;
    const mapped = mappedWorkspacePath(
      record.cwd,
      sourceWorkspacePath,
      destinationWorkspacePath
    );
    if (mapped === null) return record;
    changed += 1;
    return { ...record, cwd: mapped };
  });
  if (required && changed === 0) {
    throw new ClaudeTransferError('CLAUDE_PAYLOAD_INVALID', 'Claude transcript has no workspace metadata to update.');
  }
  return changed === 0
    ? body
    : Buffer.from(rewritten.map((record) => JSON.stringify(record)).join('\n') + '\n');
}

function assertInstallation(installation: ReadyInstallation): void {
  if (installation.provider !== 'claude') {
    throw new ClaudeTransferError('CLAUDE_INSTALLATION_INVALID', 'Claude transfer requires a Claude Code installation.');
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('The Claude transfer was cancelled.');
  error.name = 'AbortError';
  throw error;
}

function projectPaths(configRoot: string, workspacePath: string, nativeSessionId: string) {
  const project = join(configRoot, 'projects', claudeProjectDirectoryName(workspacePath));
  return {
    project,
    transcript: join(project, `${nativeSessionId}.jsonl`),
    companion: join(project, nativeSessionId)
  };
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

interface CreateClaudeTransferAdapterOptions {
  configRoot: string;
  homeDirectory?: string;
  env?: Environment;
  discoverSessions?: (installation: ReadyInstallation) => Promise<ProviderSessionDiscoveryResult>;
  verifiedRoutes?: readonly VerifiedTransferRoute[];
}

export function createClaudeTransferAdapter({
  configRoot,
  homeDirectory = dirname(resolve(configRoot)),
  env = {},
  discoverSessions = async () => discoverClaudeSessions({ homeDirectory, env }),
  verifiedRoutes = VERIFIED_TRANSFER_ROUTES
}: CreateClaudeTransferAdapterOptions): ProviderTransferAdapter {
  const providerRoot = resolve(configRoot);
  const projectsRoot = join(providerRoot, 'projects');
  return {
    provider: 'claude',
    capabilities(input) {
      const route = verifiedRoutes.some((candidate) =>
        candidate.provider === 'claude' &&
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
        throw new ClaudeTransferError('CLAUDE_SOURCE_INVALID', 'Claude transfer requires one native transcript source.');
      }
      const sourcePath = resolve(input.sourceKeys[0]!);
      const expectedProject = claudeProjectDirectoryName(input.expectedWorkspacePath);
      if (!insideRoot(projectsRoot, sourcePath) || parse(sourcePath).name !== input.nativeSessionId ||
          !sourcePath.endsWith('.jsonl') || !sameProjectDirectory(
            dirname(sourcePath).split(/[\\/]/).at(-1) ?? '',
            expectedProject,
            input.expectedWorkspacePath
          )) {
        throw new ClaudeTransferError('CLAUDE_SOURCE_INVALID', 'Claude transcript is outside its expected provider project.');
      }
      const main = await stableRead(sourcePath, MAX_TOTAL_BYTES);
      const metadata = nativeMetadata(main.toString('utf8'));
      if (metadata.nativeSessionId !== input.nativeSessionId ||
          !metadata.workspacePaths.some((path) => sameWorkspacePath(input.expectedWorkspacePath, path)) ||
          metadata.title !== input.expectedTitle) {
        throw new ClaudeTransferError('CLAUDE_SOURCE_CHANGED', 'Claude session changed before export.');
      }
      const companionRoot = join(dirname(sourcePath), input.nativeSessionId);
      const companionFiles = await exists(companionRoot)
        ? await enumerateCompanion(companionRoot)
        : [];
      const envelope: ClaudeEnvelope = {
        schemaVersion: 1,
        provider: 'claude',
        nativeSessionId: metadata.nativeSessionId,
        workspacePath: input.expectedWorkspacePath,
        title: metadata.title,
        files: [encodedFile('session.jsonl', main), ...companionFiles]
      };
      const body = JSON.stringify(envelope);
      if (Buffer.byteLength(body, 'utf8') > MAX_ENVELOPE_BYTES) {
        throw new ClaudeTransferError('CLAUDE_SOURCE_LIMIT', 'Claude session bundle is too large.');
      }
      const payloadPath = join(input.stagingDirectory, 'claude-session.json');
      await writeFile(payloadPath, body, { encoding: 'utf8', flag: 'wx' });
      return {
        provider: 'claude', nativeSessionId: metadata.nativeSessionId,
        workspacePath: input.expectedWorkspacePath, title: metadata.title,
        payloadPath, size: Buffer.byteLength(body, 'utf8')
      };
    },
    async inspectImport(input): Promise<ProviderImportInspection> {
      const envelope = await readEnvelope(input.payloadPath);
      return {
        provider: 'claude', nativeSessionId: envelope.nativeSessionId,
        workspacePath: envelope.workspacePath, title: envelope.title,
        payloadPath: input.payloadPath
      };
    },
    async importSession(input) {
      assertInstallation(input.installation);
      if (!isPortableAbsolutePath(input.destinationWorkspacePath)) {
        throw new ClaudeTransferError('CLAUDE_WORKSPACE_PATH_INVALID', 'Claude import requires an absolute workspace.');
      }
      throwIfAborted(input.signal);
      const envelope = await readEnvelope(input.inspection.payloadPath);
      if (envelope.nativeSessionId !== input.inspection.nativeSessionId ||
          envelope.workspacePath !== input.inspection.workspacePath ||
          envelope.title !== input.inspection.title) {
        throw new ClaudeTransferError('CLAUDE_SOURCE_CHANGED', 'Claude staged payload changed before import.');
      }
      const before = await discoverSessions(input.installation);
      if (before.sessions.some((session) => session.nativeId === envelope.nativeSessionId)) {
        return { status: 'duplicate' as const, nativeSessionId: envelope.nativeSessionId };
      }
      const destination = projectPaths(providerRoot, input.destinationWorkspacePath, envelope.nativeSessionId);
      if (await exists(destination.transcript)) {
        return { status: 'duplicate' as const, nativeSessionId: envelope.nativeSessionId };
      }
      const sidecars = envelope.files.filter((file) => file.path !== 'session.jsonl');
      if (sidecars.length > 0 && await exists(destination.companion)) {
        throw new ClaudeTransferError('CLAUDE_DESTINATION_COLLISION', 'Claude destination companion already exists.');
      }
      await mkdir(destination.project, { recursive: true });
      let companionCreated = false;
      let transcriptCreated = false;
      try {
        if (sidecars.length > 0) {
          await mkdir(destination.companion);
          companionCreated = true;
          for (const file of sidecars) {
            const relativePath = file.path.slice('session/'.length);
            const target = join(destination.companion, ...relativePath.split('/'));
            await mkdir(dirname(target), { recursive: true });
            const decoded = decodeFile(file);
            const body = file.path.endsWith('.jsonl')
              ? rewriteJsonl(decoded, envelope.workspacePath, input.destinationWorkspacePath, false)
              : decoded;
            await writeFile(target, body, { flag: 'wx' });
          }
        }
        const main = decodeFile(envelope.files.find((file) => file.path === 'session.jsonl')!);
        await writeFile(
          destination.transcript,
          rewriteJsonl(main, envelope.workspacePath, input.destinationWorkspacePath, true),
          { flag: 'wx' }
        );
        transcriptCreated = true;
      } catch (error) {
        if (transcriptCreated) await rm(destination.transcript, { force: true }).catch(() => undefined);
        if (companionCreated) await rm(destination.companion, { recursive: true, force: true }).catch(() => undefined);
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') {
          return { status: 'duplicate' as const, nativeSessionId: envelope.nativeSessionId };
        }
        throw error;
      }
      return {
        status: 'imported' as const,
        nativeSessionId: envelope.nativeSessionId,
        payloadPath: destination.transcript
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
      if (!isPortableAbsolutePath(input.workspacePath) || !SESSION_ID_PATTERN.test(input.nativeSessionId)) {
        throw new ClaudeTransferError('CLAUDE_ROLLBACK_INVALID', 'Claude rollback identity is invalid.');
      }
      const destination = projectPaths(providerRoot, input.workspacePath, input.nativeSessionId);
      await rm(destination.transcript, { force: true });
      await rm(destination.companion, { recursive: true, force: true });
    }
  };
}
