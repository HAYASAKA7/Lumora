import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  ProviderInstallation,
  SystemInfo
} from '../../../shared/contracts';
import { isPortableAbsolutePath } from '../../providers/session-discovery';
import {
  discoverOpenCodeSessions,
  executeStructuredCommand,
  type StructuredCommandInvocation,
  type StructuredCommandOutput,
  type StructuredCommandRunner
} from '../../providers/opencode-session-source';
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
const MAX_EXPORT_BYTES = 64 * 1024 * 1024;
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024 * 1024;
const SAFE_NATIVE_ID = /^[A-Za-z0-9._:-]{1,256}$/;

export class OpenCodeTransferError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'OpenCodeTransferError';
  }
}

interface TransferInvocationInput {
  operation: 'export' | 'import' | 'delete';
  executablePath: string;
  nativeSessionId?: string;
  payloadPath?: string;
  platform: SystemInfo['platform'];
  env: Environment;
}

export type OpenCodeTransferInvocation = Pick<
  StructuredCommandInvocation,
  'file' | 'args' | 'shell' | 'windowsHide' | 'windowsVerbatimArguments'
>;

function environmentValue(env: Environment, key: string): string | undefined {
  const matching = Object.keys(env).find(
    (candidate) => candidate.toLocaleLowerCase() === key.toLocaleLowerCase()
  );
  return matching === undefined ? undefined : env[matching];
}

function commandArguments(input: TransferInvocationInput): readonly string[] {
  if (input.operation === 'import') {
    if (input.payloadPath === undefined || !isPortableAbsolutePath(input.payloadPath)) {
      throw new OpenCodeTransferError(
        'OPENCODE_PAYLOAD_PATH_INVALID',
        'OpenCode import requires an absolute staged payload path.'
      );
    }
    return ['import', input.payloadPath];
  }
  if (input.nativeSessionId === undefined || !SAFE_NATIVE_ID.test(input.nativeSessionId)) {
    throw new OpenCodeTransferError(
      'OPENCODE_SESSION_ID_INVALID',
      'OpenCode session identity cannot be invoked safely.'
    );
  }
  return input.operation === 'export'
    ? ['export', input.nativeSessionId]
    : ['session', 'delete', input.nativeSessionId];
}

export function buildOpenCodeTransferInvocation(
  input: TransferInvocationInput
): OpenCodeTransferInvocation {
  const args = commandArguments(input);
  if (input.platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(input.executablePath)) {
    return {
      file: input.executablePath,
      args,
      shell: false,
      windowsHide: true
    };
  }
  if (/["%\r\n]/.test(input.executablePath)) {
    throw new OpenCodeTransferError(
      'OPENCODE_SHIM_PATH_UNSAFE',
      'OpenCode command shim cannot be invoked safely.'
    );
  }
  if (args.some((argument) => /["%\r\n]/.test(argument))) {
    throw new OpenCodeTransferError(
      'OPENCODE_ARGUMENT_UNSAFE',
      'OpenCode transfer argument cannot be invoked safely.'
    );
  }
  const command = [
    `"${input.executablePath}"`,
    ...args.map((argument) =>
      /\s/.test(argument) ? `"${argument}"` : argument
    )
  ].join(' ');
  return {
    file: environmentValue(input.env, 'ComSpec')?.trim() || 'cmd.exe',
    args: ['/d', '/s', '/c', `"${command}"`],
    shell: false,
    windowsHide: true,
    windowsVerbatimArguments: true
  };
}

interface OpenCodeExportShape {
  info: {
    id: string;
    directory: string;
    title: string;
    [key: string]: unknown;
  };
  messages: unknown[];
  [key: string]: unknown;
}

function parseOpenCodeExport(raw: string): OpenCodeExportShape {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new OpenCodeTransferError(
      'OPENCODE_EXPORT_INVALID',
      'OpenCode export returned invalid JSON.'
    );
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OpenCodeTransferError(
      'OPENCODE_EXPORT_INVALID',
      'OpenCode export payload is invalid.'
    );
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.info !== 'object' ||
    row.info === null ||
    Array.isArray(row.info) ||
    !Array.isArray(row.messages)
  ) {
    throw new OpenCodeTransferError(
      'OPENCODE_EXPORT_INVALID',
      'OpenCode export payload is incomplete.'
    );
  }
  const info = row.info as Record<string, unknown>;
  if (
    typeof info.id !== 'string' ||
    !SAFE_NATIVE_ID.test(info.id) ||
    typeof info.directory !== 'string' ||
    !isPortableAbsolutePath(info.directory) ||
    typeof info.title !== 'string' ||
    info.title.trim().length < 1 ||
    info.title.trim().length > 256
  ) {
    throw new OpenCodeTransferError(
      'OPENCODE_EXPORT_INVALID',
      'OpenCode session metadata is invalid.'
    );
  }
  return value as OpenCodeExportShape;
}

function assertOpenCodeInstallation(
  installation: ReadyInstallation
): void {
  if (installation.provider !== 'opencode') {
    throw new OpenCodeTransferError(
      'OPENCODE_INSTALLATION_INVALID',
      'OpenCode transfer requires an OpenCode installation.'
    );
  }
}
function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('The OpenCode transfer was cancelled.');
  error.name = 'AbortError';
  throw error;
}

function assertCommandOutput(
  output: StructuredCommandOutput,
  maxOutputBytes = MAX_COMMAND_OUTPUT_BYTES
): void {
  if (output.timedOut) {
    throw new OpenCodeTransferError(
      'OPENCODE_COMMAND_TIMEOUT',
      'OpenCode transfer command timed out.'
    );
  }
  if (
    output.outputTruncated ||
    Buffer.byteLength(output.stdout, 'utf8') > maxOutputBytes
  ) {
    throw new OpenCodeTransferError(
      'OPENCODE_OUTPUT_LIMIT',
      'OpenCode transfer command exceeded its output limit.'
    );
  }
  if (output.exitCode !== 0) {
    throw new OpenCodeTransferError(
      'OPENCODE_COMMAND_FAILED',
      'OpenCode transfer command failed.'
    );
  }
}

interface CreateOpenCodeTransferAdapterOptions {
  platform: SystemInfo['platform'];
  env: Environment;
  runCommand?: StructuredCommandRunner;
  discoverSessions?: (
    installation: ReadyInstallation
  ) => ReturnType<typeof discoverOpenCodeSessions>;
  verifiedRoutes?: readonly VerifiedTransferRoute[];
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export function createOpenCodeTransferAdapter({
  platform,
  env,
  runCommand = executeStructuredCommand,
  discoverSessions = (installation) =>
    discoverOpenCodeSessions({ installation, env, platform }),
  verifiedRoutes = VERIFIED_TRANSFER_ROUTES,
  timeoutMs = 30_000,
  maxOutputBytes = MAX_COMMAND_OUTPUT_BYTES
}: CreateOpenCodeTransferAdapterOptions): ProviderTransferAdapter {
  const run = async (
    installation: ReadyInstallation,
    invocation: OpenCodeTransferInvocation
  ): Promise<StructuredCommandOutput> => {
    const output = await runCommand({
      ...invocation,
      env: { ...env, NO_COLOR: '1' },
      timeoutMs,
      maxOutputBytes
    });
    assertCommandOutput(output, maxOutputBytes);
    return output;
  };

  const rollback = async (
    installation: ReadyInstallation,
    nativeSessionId: string
  ): Promise<void> => {
    await run(
      installation,
      buildOpenCodeTransferInvocation({
        operation: 'delete',
        executablePath: installation.executablePath,
        nativeSessionId,
        platform,
        env
      })
    );
  };

  return {
    provider: 'opencode',
    capabilities(input) {
      const route = verifiedRoutes.some(
        (candidate) =>
          candidate.provider === 'opencode' &&
          candidate.sourcePlatform === input.sourcePlatform &&
          candidate.destinationPlatform === input.destinationPlatform &&
          candidate.providerVersion === input.providerVersion
      );
      return { export: route, import: route };
    },
    async exportSession(input): Promise<ProviderExportPayload> {
      assertOpenCodeInstallation(input.installation);
      throwIfAborted(input.signal);
      const output = await run(
        input.installation,
        buildOpenCodeTransferInvocation({
          operation: 'export',
          executablePath: input.installation.executablePath,
          nativeSessionId: input.nativeSessionId,
          platform,
          env
        })
      );
      throwIfAborted(input.signal);
      const bytes = Buffer.byteLength(output.stdout, 'utf8');
      if (bytes > MAX_EXPORT_BYTES) {
        throw new OpenCodeTransferError(
          'OPENCODE_OUTPUT_LIMIT',
          'OpenCode export exceeded the payload limit.'
        );
      }
      const parsed = parseOpenCodeExport(output.stdout);
      if (
        parsed.info.id !== input.nativeSessionId ||
        parsed.info.directory !== input.expectedWorkspacePath ||
        parsed.info.title.trim() !== input.expectedTitle
      ) {
        throw new OpenCodeTransferError(
          'OPENCODE_SOURCE_CHANGED',
          'OpenCode session changed while it was being exported.'
        );
      }
      const payloadPath = join(
        input.stagingDirectory,
        'opencode-session.json'
      );
      await writeFile(payloadPath, output.stdout, {
        encoding: 'utf8',
        flag: 'wx'
      });
      return {
        provider: 'opencode',
        nativeSessionId: parsed.info.id,
        workspacePath: parsed.info.directory,
        title: parsed.info.title.trim(),
        payloadPath,
        size: bytes
      };
    },
    async inspectImport(input): Promise<ProviderImportInspection> {
      const size = await assertRegularFile(input.payloadPath);
      if (size < 2 || size > MAX_EXPORT_BYTES) {
        throw new OpenCodeTransferError(
          'OPENCODE_OUTPUT_LIMIT',
          'OpenCode import payload exceeds the size limit.'
        );
      }
      const parsed = parseOpenCodeExport(
        await readFile(input.payloadPath, 'utf8')
      );
      return {
        provider: 'opencode',
        nativeSessionId: parsed.info.id,
        workspacePath: parsed.info.directory,
        title: parsed.info.title.trim(),
        payloadPath: input.payloadPath
      };
    },
    async importSession(input) {
      assertOpenCodeInstallation(input.installation);
      if (!isPortableAbsolutePath(input.destinationWorkspacePath)) {
        throw new OpenCodeTransferError(
          'OPENCODE_WORKSPACE_PATH_INVALID',
          'OpenCode import requires an absolute destination workspace.'
        );
      }
      throwIfAborted(input.signal);
      const before = await discoverSessions(input.installation);
      if (
        before.sessions.some(
          (session) => session.nativeId === input.inspection.nativeSessionId
        )
      ) {
        return {
          status: 'duplicate' as const,
          nativeSessionId: input.inspection.nativeSessionId
        };
      }
      const raw = await readFile(input.inspection.payloadPath, 'utf8');
      const parsed = parseOpenCodeExport(raw);
      if (
        parsed.info.id !== input.inspection.nativeSessionId ||
        parsed.info.directory !== input.inspection.workspacePath ||
        parsed.info.title.trim() !== input.inspection.title
      ) {
        throw new OpenCodeTransferError(
          'OPENCODE_SOURCE_CHANGED',
          'OpenCode staged payload changed before import.'
        );
      }
      parsed.info.directory = input.destinationWorkspacePath;
      const payloadPath = join(
        input.stagingDirectory,
        'opencode-import.json'
      );
      await writeFile(payloadPath, JSON.stringify(parsed), {
        encoding: 'utf8',
        flag: 'wx'
      });
      const output = await run(
        input.installation,
        buildOpenCodeTransferInvocation({
          operation: 'import',
          executablePath: input.installation.executablePath,
          payloadPath,
          platform,
          env
        })
      );
      throwIfAborted(input.signal);
      const importedId = /(?:^|\r?\n)Imported session: ([A-Za-z0-9._:-]{1,256})(?:\r?\n|$)/
        .exec(output.stdout.trim())?.[1];
      if (importedId === undefined) {
        throw new OpenCodeTransferError(
          'OPENCODE_IMPORT_RESULT_INVALID',
          'OpenCode import did not return a session identity.'
        );
      }
      if (importedId !== input.inspection.nativeSessionId) {
        await rollback(input.installation, importedId).catch(() => undefined);
        throw new OpenCodeTransferError(
          'OPENCODE_NATIVE_ID_CHANGED',
          'OpenCode assigned a different session identity during import.'
        );
      }
      return {
        status: 'imported' as const,
        nativeSessionId: importedId,
        payloadPath
      };
    },
    async verifyImportedSession(input) {
      assertOpenCodeInstallation(input.installation);
      const discovered = await discoverSessions(input.installation);
      return discovered.sessions.some(
        (session) =>
          session.nativeId === input.nativeSessionId &&
          session.workspacePath === input.workspacePath &&
          session.title === input.title
      );
    },
    async rollbackImport(input) {
      assertOpenCodeInstallation(input.installation);
      await rollback(input.installation, input.nativeSessionId);
    }
  };
}
