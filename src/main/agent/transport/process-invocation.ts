import { spawn } from 'node:child_process';
import { posix, win32 } from 'node:path';

import type { SystemInfo } from '../../../shared/contracts';
import {
  createLineJsonRpcTransport,
  type CreateLineJsonRpcTransportOptions,
  type LineJsonRpcTransport
} from './line-json-rpc';

type SupportedPlatform = SystemInfo['platform'];
type Environment = Readonly<Record<string, string | undefined>>;

export interface StructuredProcessInvocation {
  file: string;
  args: readonly string[];
  windowsVerbatimArguments: boolean;
}

export interface StructuredProcessInvocationOptions {
  platform: SupportedPlatform;
  env: Environment;
}

export interface SpawnStructuredTransportOptions
  extends StructuredProcessInvocationOptions,
    CreateLineJsonRpcTransportOptions {
  cwd?: string;
}

function readWindowsEnvironmentValue(
  env: Environment,
  key: string
): string | undefined {
  const matchingKey = Object.keys(env).find(
    (candidate) => candidate.toLowerCase() === key.toLowerCase()
  );
  return matchingKey === undefined ? undefined : env[matchingKey];
}

const SAFE_WRAPPER_ARGUMENT = /^(?:--?)?[a-z0-9][a-z0-9._:=/-]{0,255}$/i;

export function buildStructuredProcessInvocation(
  executablePath: string,
  args: readonly string[],
  { platform, env }: StructuredProcessInvocationOptions
): StructuredProcessInvocation {
  const pathApi = platform === 'win32' ? win32 : posix;
  if (!pathApi.isAbsolute(executablePath)) {
    throw new Error('The structured provider executable path must be absolute.');
  }

  const isWindowsWrapper =
    platform === 'win32' && /\.(?:cmd|bat)$/i.test(executablePath);
  if (!isWindowsWrapper) {
    return {
      file: executablePath,
      args: [...args],
      windowsVerbatimArguments: false
    };
  }

  if (/[%!"\r\n]/.test(executablePath)) {
    throw new Error('The structured provider wrapper cannot be invoked safely.');
  }
  if (args.some((argument) => !SAFE_WRAPPER_ARGUMENT.test(argument))) {
    throw new Error('The structured provider wrapper argument is invalid.');
  }

  const commandProcessor =
    readWindowsEnvironmentValue(env, 'ComSpec') ?? 'cmd.exe';
  const command = [`"${executablePath}"`, ...args].join(' ');
  return {
    file: commandProcessor,
    args: ['/d', '/s', '/c', `"${command}"`],
    windowsVerbatimArguments: true
  };
}

export function spawnStructuredLineTransport(
  executablePath: string,
  args: readonly string[],
  options: SpawnStructuredTransportOptions
): LineJsonRpcTransport {
  const invocation = buildStructuredProcessInvocation(
    executablePath,
    args,
    options
  );
  const child = spawn(invocation.file, [...invocation.args], {
    env: { ...options.env, NO_COLOR: '1' },
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments
  });
  return createLineJsonRpcTransport(child, {
    ...(options.requestTimeoutMs === undefined
      ? {}
      : { requestTimeoutMs: options.requestTimeoutMs }),
    ...(options.maxFrameBytes === undefined
      ? {}
      : { maxFrameBytes: options.maxFrameBytes }),
    ...(options.closeGraceMs === undefined
      ? {}
      : { closeGraceMs: options.closeGraceMs }),
    ...(options.handleRequest === undefined
      ? {}
      : { handleRequest: options.handleRequest })
  });
}
