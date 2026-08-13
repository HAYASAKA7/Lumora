import { createHash } from 'node:crypto';
import {
  appendFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile
} from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
  win32
} from 'node:path';

import { z } from 'zod';

import type { ProviderInstallation, SystemInfo } from '../../../shared/contracts';
import { discoverKimiSessions } from '../../providers/kimi-session-source';
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

const MAX_FILE_COUNT = 2_048;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_ENVELOPE_BYTES = 96 * 1024 * 1024;
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const WINDOWS_ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\|\/\/)/;

const KimiFileSchema = z.strictObject({
  path: z.string().min(1).max(1_024),
  size: z.number().int().min(0).max(MAX_TOTAL_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  contentBase64: z.string().max(Math.ceil(MAX_TOTAL_BYTES * 4 / 3) + 4)
});

const KimiEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provider: z.literal('kimi'),
  nativeSessionId: z.string().regex(SESSION_ID_PATTERN),
  workspacePath: z.string().min(1).max(32_768).refine(isPortableAbsolutePath),
  title: z.string().trim().min(1).max(256),
  files: z.array(KimiFileSchema).min(2).max(MAX_FILE_COUNT)
});

type KimiFile = z.infer<typeof KimiFileSchema>;
type KimiEnvelope = z.infer<typeof KimiEnvelopeSchema>;

interface CreateKimiTransferAdapterOptions {
  platform: SystemInfo['platform'];
  kimiRoot: string;
  discoverSessions?: (
    installation: ReadyInstallation
  ) => Promise<ProviderSessionDiscoveryResult>;
  verifiedRoutes?: readonly VerifiedTransferRoute[];
}

export class KimiTransferError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'KimiTransferError';
  }
}

function normalizedWorkDirectory(workspacePath: string): string {
  if (WINDOWS_ABSOLUTE_PATH.test(workspacePath)) {
    return win32.resolve(workspacePath).replaceAll('\\', '/');
  }
  return posix.isAbsolute(workspacePath)
    ? posix.resolve(workspacePath)
    : resolve(workspacePath);
}

function workDirectorySlug(workspacePath: string): string {
  const name = WINDOWS_ABSOLUTE_PATH.test(workspacePath)
    ? win32.basename(workspacePath)
    : basename(workspacePath);
  const slug = name
    .toLocaleLowerCase('en-US')
    .replaceAll(/[^a-z0-9._-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 40)
    .replaceAll(/^-+|-+$/g, '');
  return slug === '' || slug === '.' || slug === '..' ? 'workspace' : slug;
}

export function kimiWorkDirectoryKey(workspacePath: string): string {
  const normalized = normalizedWorkDirectory(workspacePath);
  const digest = createHash('sha256').update(normalized).digest('hex').slice(0, 12);
  return `wd_${workDirectorySlug(normalized)}_${digest}`;
}

function assertInstallation(installation: ReadyInstallation): void {
  if (installation.provider !== 'kimi') {
    throw new KimiTransferError(
      'KIMI_INSTALLATION_INVALID',
      'Kimi transfer requires a Kimi Code installation.'
    );
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('The Kimi transfer was cancelled.');
  error.name = 'AbortError';
  throw error;
}

function inside(root: string, candidate: string): boolean {
  const value = relative(resolve(root), resolve(candidate));
  return value !== '' && value !== '..' && !value.startsWith(`..${sep}`) &&
    !isAbsolute(value);
}

function safeRelativePath(path: string): boolean {
  if (
    path.length < 1 ||
    path.length > 1_024 ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.startsWith('/') ||
    /^[A-Za-z]:/.test(path)
  ) return false;
  return path.split('/').every(
    (segment) => segment.length > 0 && segment !== '.' && segment !== '..'
  );
}

function stateTitle(raw: Buffer): string {
  let value: unknown;
  try {
    value = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new KimiTransferError(
      'KIMI_PAYLOAD_INVALID',
      'Kimi state metadata is invalid.'
    );
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new KimiTransferError(
      'KIMI_PAYLOAD_INVALID',
      'Kimi state metadata is invalid.'
    );
  }
  const record = value as Record<string, unknown>;
  for (const candidate of [record.title, record.lastPrompt]) {
    if (
      typeof candidate === 'string' &&
      candidate.trim().length > 0 &&
      candidate.trim().length <= 256 &&
      !/[\0\r\n]/.test(candidate)
    ) return candidate.trim();
  }
  return 'Untitled session';
}

function encodedFile(path: string, body: Buffer): KimiFile {
  return {
    path,
    size: body.length,
    sha256: createHash('sha256').update(body).digest('hex'),
    contentBase64: body.toString('base64')
  };
}

function decodedFile(file: KimiFile): Buffer {
  if (!safeRelativePath(file.path)) {
    throw new KimiTransferError(
      'KIMI_PAYLOAD_INVALID',
      'Kimi transfer contains an unsafe file path.'
    );
  }
  const body = Buffer.from(file.contentBase64, 'base64');
  if (
    body.length !== file.size ||
    body.toString('base64') !== file.contentBase64 ||
    createHash('sha256').update(body).digest('hex') !== file.sha256
  ) {
    throw new KimiTransferError(
      'KIMI_PAYLOAD_INVALID',
      'Kimi transfer file integrity is invalid.'
    );
  }
  return body;
}

async function stableRead(path: string, maximumBytes: number): Promise<Buffer> {
  const before = await lstat(path);
  if (
    before.isSymbolicLink() ||
    !before.isFile() ||
    before.size > maximumBytes
  ) {
    throw new KimiTransferError(
      'KIMI_SOURCE_INVALID',
      'Kimi session contains an unsafe or oversized file.'
    );
  }
  const body = await readFile(path);
  const after = await lstat(path);
  if (
    after.isSymbolicLink() ||
    !after.isFile() ||
    before.size !== after.size ||
    Math.trunc(before.mtimeMs) !== Math.trunc(after.mtimeMs)
  ) {
    throw new KimiTransferError(
      'KIMI_SOURCE_CHANGED',
      'Kimi session changed while it was being exported.'
    );
  }
  return body;
}

async function enumerateSession(sessionDirectory: string): Promise<KimiFile[]> {
  const files: KimiFile[] = [];
  const pending: { absolute: string; relative: string }[] = [{
    absolute: sessionDirectory,
    relative: ''
  }];
  let totalBytes = 0;
  while (pending.length > 0) {
    const directory = pending.shift()!;
    const entries = await readdir(directory.absolute, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
        throw new KimiTransferError(
          'KIMI_SOURCE_INVALID',
          'Kimi session contains an unsafe filesystem entry.'
        );
      }
      const childRelative = directory.relative === ''
        ? entry.name
        : `${directory.relative}/${entry.name}`;
      const childAbsolute = join(directory.absolute, entry.name);
      if (entry.isDirectory()) {
        pending.push({ absolute: childAbsolute, relative: childRelative });
        continue;
      }
      if (files.length >= MAX_FILE_COUNT) {
        throw new KimiTransferError(
          'KIMI_SOURCE_LIMIT',
          'Kimi session contains too many files.'
        );
      }
      const body = await stableRead(childAbsolute, MAX_TOTAL_BYTES - totalBytes);
      totalBytes += body.length;
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new KimiTransferError(
          'KIMI_SOURCE_LIMIT',
          'Kimi session is too large to transfer.'
        );
      }
      files.push(encodedFile(childRelative, body));
    }
  }
  return files;
}

function validateEnvelope(value: unknown): KimiEnvelope {
  const parsed = KimiEnvelopeSchema.safeParse(value);
  if (!parsed.success) {
    throw new KimiTransferError(
      'KIMI_PAYLOAD_INVALID',
      'Kimi transfer payload is invalid.'
    );
  }
  const paths = new Set<string>();
  let totalBytes = 0;
  for (const file of parsed.data.files) {
    if (paths.has(file.path)) {
      throw new KimiTransferError(
        'KIMI_PAYLOAD_INVALID',
        'Kimi transfer contains duplicate files.'
      );
    }
    paths.add(file.path);
    totalBytes += decodedFile(file).length;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new KimiTransferError(
        'KIMI_PAYLOAD_INVALID',
        'Kimi transfer payload is too large.'
      );
    }
  }
  if (!paths.has('state.json') || !paths.has('agents/main/wire.jsonl')) {
    throw new KimiTransferError(
      'KIMI_PAYLOAD_INVALID',
      'Kimi transfer is missing required session files.'
    );
  }
  const state = parsed.data.files.find((file) => file.path === 'state.json')!;
  if (stateTitle(decodedFile(state)) !== parsed.data.title) {
    throw new KimiTransferError(
      'KIMI_PAYLOAD_INVALID',
      'Kimi payload metadata does not match its native state.'
    );
  }
  return parsed.data;
}

async function readEnvelope(payloadPath: string): Promise<KimiEnvelope> {
  const size = await assertRegularFile(payloadPath);
  if (size < 2 || size > MAX_ENVELOPE_BYTES) {
    throw new KimiTransferError(
      'KIMI_PAYLOAD_INVALID',
      'Kimi transfer payload is unavailable or too large.'
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(payloadPath, 'utf8'));
  } catch {
    throw new KimiTransferError(
      'KIMI_PAYLOAD_INVALID',
      'Kimi transfer payload is invalid.'
    );
  }
  return validateEnvelope(value);
}

function sessionDirectory(
  storageRoot: string,
  workspacePath: string,
  nativeSessionId: string
): string {
  return join(
    storageRoot,
    'sessions',
    kimiWorkDirectoryKey(workspacePath),
    nativeSessionId
  );
}

async function appendIndexRecord(
  storageRoot: string,
  record: Record<string, unknown>
): Promise<void> {
  await mkdir(storageRoot, { recursive: true });
  await appendFile(
    join(storageRoot, 'session_index.jsonl'),
    `${JSON.stringify(record)}\n`,
    { encoding: 'utf8', mode: 0o600 }
  );
}

function matchesInspection(
  envelope: KimiEnvelope,
  inspection: ProviderImportInspection
): boolean {
  return inspection.provider === 'kimi' &&
    envelope.nativeSessionId === inspection.nativeSessionId &&
    envelope.workspacePath === inspection.workspacePath &&
    envelope.title === inspection.title;
}

export function createKimiTransferAdapter({
  platform: _platform,
  kimiRoot,
  discoverSessions = async () => discoverKimiSessions({ kimiRoot }),
  verifiedRoutes = VERIFIED_TRANSFER_ROUTES
}: CreateKimiTransferAdapterOptions): ProviderTransferAdapter {
  const storageRoot = resolve(kimiRoot);
  return {
    provider: 'kimi',
    capabilities(input) {
      const route = verifiedRoutes.some((candidate) =>
        candidate.provider === 'kimi' &&
        candidate.sourcePlatform === input.sourcePlatform &&
        candidate.destinationPlatform === input.destinationPlatform &&
        candidate.providerVersion === input.providerVersion
      );
      return { export: route, import: route };
    },
    async exportSession(input): Promise<ProviderExportPayload> {
      assertInstallation(input.installation);
      throwIfAborted(input.signal);
      if (
        input.sourceKeys.length !== 1 ||
        !SESSION_ID_PATTERN.test(input.nativeSessionId) ||
        !isPortableAbsolutePath(input.expectedWorkspacePath)
      ) {
        throw new KimiTransferError(
          'KIMI_SOURCE_INVALID',
          'Kimi transfer requires one valid native session source.'
        );
      }
      const statePath = resolve(input.sourceKeys[0]!);
      const expectedDirectory = sessionDirectory(
        storageRoot,
        input.expectedWorkspacePath,
        input.nativeSessionId
      );
      let canonicalState: string;
      let canonicalDirectory: string;
      try {
        const stateEntry = await lstat(statePath);
        if (stateEntry.isSymbolicLink() || !stateEntry.isFile()) {
          throw new Error('unsafe state');
        }
        canonicalState = await realpath(statePath);
        canonicalDirectory = await realpath(dirname(statePath));
      } catch {
        throw new KimiTransferError(
          'KIMI_SOURCE_INVALID',
          'Kimi session source is unavailable.'
        );
      }
      if (
        canonicalState !== join(canonicalDirectory, 'state.json') ||
        canonicalDirectory !== await realpath(expectedDirectory).catch(() => '') ||
        !inside(join(storageRoot, 'sessions'), canonicalDirectory)
      ) {
        throw new KimiTransferError(
          'KIMI_SOURCE_INVALID',
          'Kimi session source is outside its expected provider workspace.'
        );
      }
      const files = await enumerateSession(canonicalDirectory);
      const state = files.find((file) => file.path === 'state.json');
      const title = state === undefined ? null : stateTitle(decodedFile(state));
      if (
        title === null ||
        title !== input.expectedTitle ||
        !files.some((file) => file.path === 'agents/main/wire.jsonl')
      ) {
        throw new KimiTransferError(
          'KIMI_SOURCE_CHANGED',
          'Kimi session changed before export.'
        );
      }
      const envelope: KimiEnvelope = {
        schemaVersion: 1,
        provider: 'kimi',
        nativeSessionId: input.nativeSessionId,
        workspacePath: input.expectedWorkspacePath,
        title,
        files
      };
      const body = JSON.stringify(envelope);
      if (Buffer.byteLength(body, 'utf8') > MAX_ENVELOPE_BYTES) {
        throw new KimiTransferError(
          'KIMI_SOURCE_LIMIT',
          'Kimi session is too large to transfer.'
        );
      }
      const payloadPath = join(input.stagingDirectory, 'kimi-session.json');
      await writeFile(payloadPath, body, { encoding: 'utf8', flag: 'wx' });
      return {
        provider: 'kimi',
        nativeSessionId: input.nativeSessionId,
        workspacePath: input.expectedWorkspacePath,
        title,
        payloadPath,
        size: Buffer.byteLength(body, 'utf8')
      };
    },
    async inspectImport(input): Promise<ProviderImportInspection> {
      const envelope = await readEnvelope(input.payloadPath);
      return {
        provider: 'kimi',
        nativeSessionId: envelope.nativeSessionId,
        workspacePath: envelope.workspacePath,
        title: envelope.title,
        payloadPath: input.payloadPath
      };
    },
    async importSession(input) {
      assertInstallation(input.installation);
      if (!isPortableAbsolutePath(input.destinationWorkspacePath)) {
        throw new KimiTransferError(
          'KIMI_WORKSPACE_PATH_INVALID',
          'Kimi import requires an absolute destination workspace.'
        );
      }
      throwIfAborted(input.signal);
      const envelope = await readEnvelope(input.inspection.payloadPath);
      if (!matchesInspection(envelope, input.inspection)) {
        throw new KimiTransferError(
          'KIMI_SOURCE_CHANGED',
          'Kimi staged payload changed before import.'
        );
      }
      const before = await discoverSessions(input.installation);
      if (before.sessions.some((session) => session.nativeId === envelope.nativeSessionId)) {
        return {
          status: 'duplicate' as const,
          nativeSessionId: envelope.nativeSessionId
        };
      }
      const destinationDirectory = sessionDirectory(
        storageRoot,
        input.destinationWorkspacePath,
        envelope.nativeSessionId
      );
      await mkdir(dirname(destinationDirectory), { recursive: true });
      try {
        await mkdir(destinationDirectory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          return {
            status: 'duplicate' as const,
            nativeSessionId: envelope.nativeSessionId
          };
        }
        throw error;
      }
      try {
        for (const file of envelope.files) {
          throwIfAborted(input.signal);
          const target = join(destinationDirectory, ...file.path.split('/'));
          if (!inside(destinationDirectory, target)) {
            throw new KimiTransferError(
              'KIMI_PAYLOAD_INVALID',
              'Kimi transfer contains an unsafe file path.'
            );
          }
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, decodedFile(file), { flag: 'wx', mode: 0o600 });
        }
        await appendIndexRecord(storageRoot, {
          sessionId: envelope.nativeSessionId,
          sessionDir: destinationDirectory,
          workDir: input.destinationWorkspacePath
        });
      } catch (error) {
        await rm(destinationDirectory, { recursive: true, force: true });
        throw error;
      }
      return {
        status: 'imported' as const,
        nativeSessionId: envelope.nativeSessionId,
        payloadPath: join(destinationDirectory, 'state.json')
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
      if (
        !SESSION_ID_PATTERN.test(input.nativeSessionId) ||
        !isPortableAbsolutePath(input.workspacePath)
      ) {
        throw new KimiTransferError(
          'KIMI_ROLLBACK_INVALID',
          'Kimi rollback identity is invalid.'
        );
      }
      await rm(
        sessionDirectory(storageRoot, input.workspacePath, input.nativeSessionId),
        { recursive: true, force: true }
      );
      await appendIndexRecord(storageRoot, {
        sessionId: input.nativeSessionId,
        deleted: true
      });
    }
  };
}
