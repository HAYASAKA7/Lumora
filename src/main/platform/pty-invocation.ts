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

export function resolvePtyInvocation({
  platform,
  executablePath,
  args,
  command,
  env,
  terminalProfile
}: ResolvePtyInvocationInput): PtyInvocation {
  if (args.length !== 0) {
    throw new Error('The managed-shell adapter does not accept provider arguments.');
  }

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
      return {
        executablePath: terminalProfile.executablePath,
        args: [
          ...terminalProfile.args,
          '/d',
          '/s',
          '/c',
          'call %LUMORA_PROVIDER_COMMAND%'
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
    return {
      executablePath: terminalProfile.executablePath,
      args: [
        ...terminalProfile.args,
        '/d',
        '/s',
        '/c',
        '""%LUMORA_PROVIDER_EXECUTABLE%""'
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
    args: ['/d', '/s', '/c', '""%LUMORA_PROVIDER_EXECUTABLE%""'],
    env: {
      ...providerEnvironment
    }
  };
}
