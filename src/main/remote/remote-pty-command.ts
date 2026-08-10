import { posix, win32 } from 'node:path';

import type { SystemInfo } from '../../shared/contracts';

interface RemotePtyCommandInput {
  platform: SystemInfo['platform'];
  cwd: string;
  executablePath: string;
  args: readonly string[];
  env?: Readonly<Record<string, string | undefined>>;
}

const MAX_REMOTE_VALUE_LENGTH = 32_768;
const MAX_REMOTE_ARGUMENTS = 64;
const MAX_REMOTE_ENVIRONMENT_VALUES = 8;
const REMOTE_ENVIRONMENT_NAME = /^LUMORA_[A-Z0-9_]+$/u;

function validateValue(value: string): string {
  if (
    value.length === 0 ||
    value.length > MAX_REMOTE_VALUE_LENGTH ||
    /[\0\r\n]/u.test(value)
  ) {
    throw new Error('The remote command contains an invalid value.');
  }
  return value;
}

function posixLiteral(value: string): string {
  return `'${validateValue(value).replaceAll("'", `'"'"'`)}'`;
}

function powershellLiteral(value: string): string {
  return `'${validateValue(value).replaceAll("'", "''")}'`;
}

function assertAbsolutePaths(input: RemotePtyCommandInput): void {
  const pathApi = input.platform === 'win32' ? win32 : posix;
  if (
    !pathApi.isAbsolute(input.cwd) ||
    !pathApi.isAbsolute(input.executablePath)
  ) {
    throw new Error('Remote launch paths must be absolute.');
  }
}

function environmentEntries(
  input: RemotePtyCommandInput
): Array<readonly [string, string]> {
  const entries = Object.entries(input.env ?? {})
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  if (
    entries.length > MAX_REMOTE_ENVIRONMENT_VALUES ||
    entries.some(([name]) => !REMOTE_ENVIRONMENT_NAME.test(name))
  ) {
    throw new Error('The remote command contains an invalid environment.');
  }
  return entries.map(([name, value]) => [name, validateValue(value)] as const);
}

export function buildRemotePtyCommand(input: RemotePtyCommandInput): string {
  assertAbsolutePaths(input);
  if (input.args.length > MAX_REMOTE_ARGUMENTS) {
    throw new Error('The remote command contains too many arguments.');
  }
  const environment = environmentEntries(input);
  if (input.platform !== 'win32') {
    return [
      `cd ${posixLiteral(input.cwd)} && exec`,
      ...(environment.length === 0
        ? []
        : [
            'env',
            ...environment.map(([name, value]) =>
              posixLiteral(`${name}=${value}`)
            )
          ]),
      posixLiteral(input.executablePath),
      ...input.args.map(posixLiteral)
    ].join(' ');
  }

  const invocation = [
    "$ErrorActionPreference = 'Stop';",
    `Set-Location -LiteralPath ${powershellLiteral(input.cwd)};`,
    ...environment.map(([name, value]) =>
      `$env:${name} = ${powershellLiteral(value)};`
    ),
    '&',
    powershellLiteral(input.executablePath),
    ...input.args.map(powershellLiteral),
    '; exit $LASTEXITCODE'
  ].join(' ').replace(' ; exit', '; exit');
  const encoded = Buffer.from(invocation, 'utf16le').toString('base64');
  return [
    'powershell.exe',
    '-NoLogo',
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    encoded
  ].join(' ');
}
