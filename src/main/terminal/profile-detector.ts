import { createHash } from 'node:crypto';
import { posix, win32 } from 'node:path';

import {
  TerminalProfileSchema,
  type ShellFamily,
  type SystemInfo,
  type TerminalProfile
} from '../../shared/contracts';

type Environment = Readonly<Record<string, string | undefined>>;

interface ProfileDetectorDependencies {
  platform: SystemInfo['platform'];
  env: Environment;
  findExecutable(command: string): Promise<string | null>;
  isExecutablePath(path: string): Promise<boolean>;
}

interface ShellCandidate {
  name: string;
  family: ShellFamily;
  command?: string;
  path?: string;
}

function stableProfileId(
  platform: SystemInfo['platform'],
  family: ShellFamily,
  executablePath: string,
  args: readonly string[]
): string {
  return createHash('sha256')
    .update(JSON.stringify({ platform, family, executablePath, args }))
    .digest('hex');
}

function inferShell(path: string, platform: SystemInfo['platform']): {
  name: string;
  family: ShellFamily;
} {
  const pathApi = platform === 'win32' ? win32 : posix;
  const filename = pathApi.basename(path).replace(/\.exe$/i, '');
  const normalized = filename.toLowerCase();
  const known = new Set<ShellFamily>([
    'pwsh',
    'powershell',
    'cmd',
    'zsh',
    'bash',
    'fish'
  ]);
  return {
    name: filename,
    family: known.has(normalized as ShellFamily)
      ? (normalized as ShellFamily)
      : 'other'
  };
}

function candidatesFor({
  platform,
  env
}: Pick<ProfileDetectorDependencies, 'platform' | 'env'>): ShellCandidate[] {
  if (platform === 'win32') {
    return [
      { name: 'PowerShell 7', family: 'pwsh', command: 'pwsh' },
      {
        name: 'Windows PowerShell',
        family: 'powershell',
        command: 'powershell'
      },
      { name: 'Command Prompt', family: 'cmd', command: 'cmd' }
    ];
  }

  const pathApi = posix;
  const shellPath = env.SHELL?.trim();
  const candidates: ShellCandidate[] = [];
  if (shellPath !== undefined && pathApi.isAbsolute(shellPath)) {
    const inferred = inferShell(shellPath, platform);
    candidates.push({ ...inferred, path: shellPath });
  }

  const commands =
    platform === 'darwin'
      ? (['zsh', 'bash', 'fish'] as const)
      : (['bash', 'zsh', 'fish'] as const);
  for (const command of commands) {
    candidates.push({ name: command, family: command, command });
  }
  return candidates;
}

export async function detectTerminalProfiles(
  dependencies: ProfileDetectorDependencies
): Promise<TerminalProfile[]> {
  const profiles: TerminalProfile[] = [];
  const identities = new Set<string>();

  for (const candidate of candidatesFor(dependencies)) {
    const executablePath =
      candidate.path === undefined
        ? await dependencies.findExecutable(candidate.command!)
        : (await dependencies.isExecutablePath(candidate.path))
          ? candidate.path
          : null;
    if (executablePath === null) {
      continue;
    }

    const identity =
      dependencies.platform === 'win32'
        ? executablePath.toLocaleLowerCase()
        : executablePath;
    if (identities.has(identity)) {
      continue;
    }
    identities.add(identity);

    const args: string[] = [];
    profiles.push(
      TerminalProfileSchema.parse({
        id: stableProfileId(
          dependencies.platform,
          candidate.family,
          executablePath,
          args
        ),
        kind: 'detected',
        name: candidate.name,
        shellFamily: candidate.family,
        executablePath,
        args,
        available: true,
        recommended: profiles.length === 0
      })
    );
  }

  return profiles;
}
