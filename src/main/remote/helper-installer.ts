import type { VerifiedRemoteHelperArtifact } from './helper-artifact-resolver';
import {
  createHelperDigestCommand,
  createHelperDirectoryCommand,
  type RemoteHelperPaths
} from './helper-remote-paths';
import type { RemoteCommandExecutor } from './platform-probe';
import type { RemoteFileTransfer } from './ssh-client';

const OPERATION_LIMITS = {
  timeoutMs: 15_000,
  maxOutputBytes: 64 * 1024
} as const;

export type RemoteHelperInstallerErrorCode =
  | 'REPLACEMENT_REQUIRED'
  | 'INSTALL_FAILED';

export class RemoteHelperInstallerError extends Error {
  constructor(readonly code: RemoteHelperInstallerErrorCode) {
    super(code === 'REPLACEMENT_REQUIRED'
      ? 'The installed remote helper requires replacement confirmation.'
      : 'Lumora could not install the remote helper.');
    this.name = 'RemoteHelperInstallerError';
  }
}

export type RemoteHelperInspection =
  | { status: 'missing'; paths: RemoteHelperPaths }
  | { status: 'installed'; paths: RemoteHelperPaths }
  | { status: 'invalid'; paths: RemoteHelperPaths };

interface HelperFileOperationInput {
  files: RemoteFileTransfer;
  execute: RemoteCommandExecutor;
  paths: RemoteHelperPaths;
  artifact: VerifiedRemoteHelperArtifact;
}

async function remoteDigest(
  execute: RemoteCommandExecutor,
  path: string,
  platform: VerifiedRemoteHelperArtifact['platform']
): Promise<string | null> {
  const result = await execute(
    createHelperDigestCommand(path, platform),
    OPERATION_LIMITS
  );
  if (result.exitCode !== 0) return null;
  const digest = result.stdout.match(/\b[a-fA-F0-9]{64}\b/u)?.[0];
  return digest?.toLocaleLowerCase() ?? null;
}

export async function inspectRemoteHelper({
  files,
  execute,
  paths,
  artifact
}: HelperFileOperationInput): Promise<RemoteHelperInspection> {
  const installed = await files.stat(paths.executablePath);
  if (!installed.exists) return { status: 'missing', paths };
  if (installed.size !== artifact.size) return { status: 'invalid', paths };
  try {
    const digest = await remoteDigest(execute, paths.executablePath, artifact.platform);
    return digest === artifact.sha256
      ? { status: 'installed', paths }
      : { status: 'invalid', paths };
  } catch {
    return { status: 'invalid', paths };
  }
}

export async function installRemoteHelper(input: HelperFileOperationInput & {
  replaceExisting: boolean;
}): Promise<void> {
  const inspection = await inspectRemoteHelper(input);
  if (inspection.status === 'installed') return;
  if (inspection.status === 'invalid' && !input.replaceExisting) {
    throw new RemoteHelperInstallerError('REPLACEMENT_REQUIRED');
  }

  let temporaryCreated = false;
  try {
    const directory = await input.execute(
      createHelperDirectoryCommand(input.paths, input.artifact.platform),
      OPERATION_LIMITS
    );
    if (directory.exitCode !== 0) {
      throw new RemoteHelperInstallerError('INSTALL_FAILED');
    }
    await input.files.upload(
      input.artifact.absolutePath,
      input.paths.temporaryPath
    );
    temporaryCreated = true;
    const uploaded = await input.files.stat(input.paths.temporaryPath);
    if (!uploaded.exists || uploaded.size !== input.artifact.size) {
      throw new RemoteHelperInstallerError('INSTALL_FAILED');
    }
    const digest = await remoteDigest(
      input.execute,
      input.paths.temporaryPath,
      input.artifact.platform
    );
    if (digest !== input.artifact.sha256) {
      throw new RemoteHelperInstallerError('INSTALL_FAILED');
    }
    if (input.artifact.platform !== 'win32') {
      await input.files.chmod(input.paths.temporaryPath, 0o700);
    }
    if (inspection.status === 'invalid') {
      await input.files.remove(input.paths.executablePath);
    }
    await input.files.rename(
      input.paths.temporaryPath,
      input.paths.executablePath
    );
    temporaryCreated = false;
  } catch (error) {
    if (temporaryCreated) {
      try {
        await input.files.remove(input.paths.temporaryPath);
      } catch {
        // Preserve the original sanitized installation error.
      }
    }
    if (error instanceof RemoteHelperInstallerError) throw error;
    throw new RemoteHelperInstallerError('INSTALL_FAILED');
  }
}
