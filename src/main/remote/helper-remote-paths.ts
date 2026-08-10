import { posix, win32 } from 'node:path';

type RemotePlatform = 'win32' | 'darwin' | 'linux';

const SAFE_SEGMENT = /^[A-Za-z0-9._-]{1,80}$/u;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

export interface RemoteHelperPaths {
  rootDirectory: string;
  versionDirectory: string;
  executablePath: string;
  temporaryPath: string;
}

function invalid(): never {
  throw new Error('The remote helper path is invalid.');
}

export function createRemoteHelperPaths(input: {
  platform: RemotePlatform;
  baseDirectory: string;
  helperVersion: string;
  temporaryId: string;
}): RemoteHelperPaths {
  if (
    CONTROL_CHARACTER.test(input.baseDirectory) ||
    !SAFE_SEGMENT.test(input.helperVersion) ||
    !SAFE_SEGMENT.test(input.temporaryId)
  ) invalid();

  const paths = input.platform === 'win32' ? win32 : posix;
  if (!paths.isAbsolute(input.baseDirectory)) invalid();
  const rootDirectory = input.platform === 'win32'
    ? paths.join(input.baseDirectory, 'Lumora', 'helper')
    : paths.join(input.baseDirectory, '.lumora', 'helper');
  const versionDirectory = paths.join(rootDirectory, input.helperVersion);
  const executableName = input.platform === 'win32'
    ? 'lumora-helper.exe'
    : 'lumora-helper';
  return {
    rootDirectory,
    versionDirectory,
    executablePath: paths.join(versionDirectory, executableName),
    temporaryPath: paths.join(
      versionDirectory,
      `.lumora-helper.${input.temporaryId}.tmp`
    )
  };
}

function quotePosix(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function createHelperDirectoryCommand(
  paths: RemoteHelperPaths,
  platform: RemotePlatform
): string {
  if (platform === 'win32') {
    return `powershell -NoProfile -NonInteractive -Command ` +
      `"New-Item -ItemType Directory -Force -LiteralPath ` +
      `${quotePowerShell(paths.versionDirectory)} | Out-Null"`;
  }
  return `mkdir -p -- ${quotePosix(paths.versionDirectory)}`;
}

export function helperLaunchCommand(
  paths: RemoteHelperPaths,
  platform: RemotePlatform,
  environment: {
    homeDirectory: string;
    defaultShell: string;
  }
): string {
  if (platform === 'win32') {
    return `powershell -NoProfile -NonInteractive -Command ` +
      `"$env:HOME = ${quotePowerShell(environment.homeDirectory)}; ` +
      `$env:USERPROFILE = ${quotePowerShell(environment.homeDirectory)}; ` +
      `$env:LUMORA_LOGIN_SHELL = ${quotePowerShell(environment.defaultShell)}; ` +
      `& ${quotePowerShell(paths.executablePath)}"`;
  }
  return `HOME=${quotePosix(environment.homeDirectory)} ` +
    `SHELL=${quotePosix(environment.defaultShell)} ` +
    `LUMORA_LOGIN_SHELL=${quotePosix(environment.defaultShell)} ` +
    `exec ${quotePosix(paths.executablePath)}`;
}

export function createHelperDigestCommand(
  path: string,
  platform: RemotePlatform
): string {
  if (platform === 'win32') {
    return `powershell -NoProfile -NonInteractive -Command ` +
      `"(Get-FileHash -Algorithm SHA256 -LiteralPath ` +
      `${quotePowerShell(path)}).Hash.ToLowerInvariant()"`;
  }
  if (platform === 'darwin') {
    return `shasum -a 256 -- ${quotePosix(path)}`;
  }
  return `sha256sum -- ${quotePosix(path)}`;
}
