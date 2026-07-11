import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { posix, win32 } from 'node:path';

import type { SystemInfo } from '../../shared/contracts';

type SupportedPlatform = SystemInfo['platform'];
type Environment = Readonly<Record<string, string | undefined>>;
type CandidateExists = (candidate: string) => Promise<boolean>;

interface FindExecutableOptions {
  platform: SupportedPlatform;
  env: Environment;
  candidateExists?: CandidateExists;
}

const DEFAULT_WINDOWS_EXTENSIONS = ['.EXE', '.COM', '.CMD', '.BAT'];

function readEnvironmentValue(
  env: Environment,
  key: string,
  caseInsensitive: boolean
): string | undefined {
  if (!caseInsensitive) {
    return env[key];
  }

  const matchingKey = Object.keys(env).find(
    (candidate) => candidate.toLowerCase() === key.toLowerCase()
  );
  return matchingKey === undefined ? undefined : env[matchingKey];
}

function normalizePathEntry(entry: string): string | null {
  const trimmed = entry.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    const unquoted = trimmed.slice(1, -1).trim();
    return unquoted.length === 0 ? null : unquoted;
  }

  return trimmed;
}

function getWindowsExtensions(env: Environment): readonly string[] {
  const pathExtensions = readEnvironmentValue(env, 'PATHEXT', true);
  if (pathExtensions === undefined || pathExtensions.trim().length === 0) {
    return DEFAULT_WINDOWS_EXTENSIONS;
  }

  const extensions = pathExtensions
    .split(';')
    .map((extension) => extension.trim())
    .filter((extension) => /^\.[a-z0-9]+$/i.test(extension));

  return extensions.length === 0 ? DEFAULT_WINDOWS_EXTENSIONS : extensions;
}

export async function isExecutableFile(
  candidate: string,
  platform: SupportedPlatform
): Promise<boolean> {
  try {
    const candidateStat = await stat(candidate);
    if (!candidateStat.isFile()) {
      return false;
    }

    if (platform !== 'win32') {
      await access(candidate, constants.X_OK);
    }

    return true;
  } catch {
    return false;
  }
}

export async function findExecutable(
  command: string,
  { platform, env, candidateExists }: FindExecutableOptions
): Promise<string | null> {
  if (!/^[a-z0-9_-]+$/i.test(command)) {
    throw new Error('Provider commands must be a simple executable name.');
  }

  const isWindows = platform === 'win32';
  const pathValue = readEnvironmentValue(env, 'PATH', isWindows);
  if (pathValue === undefined) {
    return null;
  }

  const pathApi = isWindows ? win32 : posix;
  const delimiter = isWindows ? ';' : ':';
  const extensions = isWindows ? getWindowsExtensions(env) : [''];
  const exists =
    candidateExists ??
    ((candidate: string) => isExecutableFile(candidate, platform));

  for (const rawEntry of pathValue.split(delimiter)) {
    const entry = normalizePathEntry(rawEntry);
    if (entry === null) {
      continue;
    }

    for (const extension of extensions) {
      const candidate = pathApi.resolve(entry, `${command}${extension}`);
      if (await exists(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}
