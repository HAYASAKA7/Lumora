import { extname } from 'node:path';

import type { SystemInfo, TerminalProfile } from '../../shared/contracts';

type Environment = Readonly<Record<string, string | undefined>>;

interface ResolvePtyInvocationInput {
  platform: SystemInfo['platform'];
  executablePath: string;
  args: readonly string[];
  command: string | null;
  env: Environment;
  terminalProfile: TerminalProfile;
}

export interface PtyInvocation {
  executablePath: string;
  args: string[];
  env: Record<string, string | undefined>;
}

function readEnvironmentValue(
  env: Environment,
  name: string
): string | undefined {
  const key = Object.keys(env).find(
    (candidate) => candidate.toLowerCase() === name.toLowerCase()
  );
  return key === undefined ? undefined : env[key];
}

function powershellArgumentsEnvironment(
  env: Environment,
  args: readonly string[]
): Record<string, string | undefined> {
  return {
    ...env,
    LUMORA_PROVIDER_ARGUMENTS: JSON.stringify(args)
  };
}

function cmdArguments(args: readonly string[]): string {
  return args.map((argument) => {
    if (/^[A-Za-z0-9._:@/\\-]+$/.test(argument)) return argument;
    if (argument.length === 0 || /[\0\r\n"%!&|^<>]/.test(argument)) {
      throw new Error(
        'The selected command shell cannot safely pass this provider argument.'
      );
    }
    return `"${argument}"`;
  }).join(' ');
}

export function resolvePtyInvocation({
  platform,
  executablePath,
  args,
  command,
  env,
  terminalProfile
}: ResolvePtyInvocationInput): PtyInvocation {
  if (command !== null) {
    if (terminalProfile.shellFamily === 'other') {
      throw new Error(
        'The selected terminal profile does not support custom provider commands.'
      );
    }
    const commandEnvironment = {
      ...env,
      LUMORA_PROVIDER_COMMAND: command
    };
    if (
      terminalProfile.shellFamily === 'pwsh' ||
      terminalProfile.shellFamily === 'powershell'
    ) {
      if (args.length !== 0) {
        return {
          executablePath: terminalProfile.executablePath,
          args: [
            ...terminalProfile.args,
            '-NoLogo',
            '-Command',
            '$lumoraArgs = @($env:LUMORA_PROVIDER_ARGUMENTS | ConvertFrom-Json); & ([scriptblock]::Create($env:LUMORA_PROVIDER_COMMAND + \' @args\')) @lumoraArgs; exit $LASTEXITCODE'
          ],
          env: powershellArgumentsEnvironment(commandEnvironment, args)
        };
      }
      return {
        executablePath: terminalProfile.executablePath,
        args: [
          ...terminalProfile.args,
          '-NoLogo',
          '-Command',
          '& ([scriptblock]::Create($env:LUMORA_PROVIDER_COMMAND)); exit $LASTEXITCODE'
        ],
        env: commandEnvironment
      };
    }
    if (terminalProfile.shellFamily === 'cmd') {
      const suffix = args.length === 0 ? '' : ` ${cmdArguments(args)}`;
      return {
        executablePath: terminalProfile.executablePath,
        args: [
          ...terminalProfile.args,
          '/d',
          '/s',
          '/c',
          `call %LUMORA_PROVIDER_COMMAND%${suffix}`
        ],
        env: commandEnvironment
      };
    }
    if (args.length !== 0) {
      return {
        executablePath: terminalProfile.executablePath,
        args: [
          ...terminalProfile.args,
          '-i',
          '-c',
          'eval "lumora_provider_command() { $LUMORA_PROVIDER_COMMAND \\"\\$@\\"; }"; lumora_provider_command "$@"',
          'lumora-provider',
          ...args
        ],
        env: commandEnvironment
      };
    }
    return {
      executablePath: terminalProfile.executablePath,
      args: [
        ...terminalProfile.args,
        '-i',
        '-c',
        'eval "exec $LUMORA_PROVIDER_COMMAND"'
      ],
      env: commandEnvironment
    };
  }

  const providerEnvironment = {
    ...env,
    LUMORA_PROVIDER_EXECUTABLE: executablePath
  };
  if (platform !== 'win32' && terminalProfile.shellFamily !== 'other') {
    if (args.length !== 0) {
      return {
        executablePath: terminalProfile.executablePath,
        args: [
          ...terminalProfile.args,
          '-c',
          'exec "$LUMORA_PROVIDER_EXECUTABLE" "$@"',
          'lumora-provider',
          ...args
        ],
        env: providerEnvironment
      };
    }
    return {
      executablePath: terminalProfile.executablePath,
      args: [
        ...terminalProfile.args,
        '-c',
        'exec "$LUMORA_PROVIDER_EXECUTABLE"'
      ],
      env: providerEnvironment
    };
  }

  if (
    platform === 'win32' &&
    (terminalProfile.shellFamily === 'pwsh' ||
      terminalProfile.shellFamily === 'powershell')
  ) {
    if (args.length !== 0) {
      return {
        executablePath: terminalProfile.executablePath,
        args: [
          ...terminalProfile.args,
          '-NoLogo',
          '-Command',
          '$lumoraArgs = @($env:LUMORA_PROVIDER_ARGUMENTS | ConvertFrom-Json); & $env:LUMORA_PROVIDER_EXECUTABLE @lumoraArgs; exit $LASTEXITCODE'
        ],
        env: powershellArgumentsEnvironment(providerEnvironment, args)
      };
    }
    return {
      executablePath: terminalProfile.executablePath,
      args: [
        ...terminalProfile.args,
        '-NoLogo',
        '-Command',
        '& $env:LUMORA_PROVIDER_EXECUTABLE; exit $LASTEXITCODE'
      ],
      env: providerEnvironment
    };
  }

  if (platform === 'win32' && terminalProfile.shellFamily === 'cmd') {
    const suffix = args.length === 0 ? '' : ` ${cmdArguments(args)}`;
    return {
      executablePath: terminalProfile.executablePath,
      args: [
        ...terminalProfile.args,
        '/d',
        '/s',
        '/c',
        args.length === 0
          ? '""%LUMORA_PROVIDER_EXECUTABLE%""'
          : `call "%LUMORA_PROVIDER_EXECUTABLE%"${suffix}`
      ],
      env: providerEnvironment
    };
  }

  const extension = extname(executablePath).toLowerCase();
  const isWindowsCommandShim =
    platform === 'win32' && (extension === '.cmd' || extension === '.bat');
  if (!isWindowsCommandShim) {
    return { executablePath, args: [...args], env: { ...env } };
  }

  return {
    executablePath: readEnvironmentValue(env, 'ComSpec') ?? 'cmd.exe',
    args: [
      '/d',
      '/s',
      '/c',
      args.length === 0
        ? '""%LUMORA_PROVIDER_EXECUTABLE%""'
        : `call "%LUMORA_PROVIDER_EXECUTABLE%" ${cmdArguments(args)}`
    ],
    env: {
      ...providerEnvironment
    }
  };
}
