import { describe, expect, it, vi } from 'vitest';

import { detectTerminalProfiles } from './profile-detector';

describe('detectTerminalProfiles', () => {
  it('orders Windows shells and recommends PowerShell 7', async () => {
    const paths: Record<string, string | null> = {
      pwsh: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      powershell: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      cmd: 'C:\\Windows\\System32\\cmd.exe'
    };

    const profiles = await detectTerminalProfiles({
      platform: 'win32',
      env: {},
      findExecutable: vi.fn(async (name) => paths[name] ?? null),
      isExecutablePath: vi.fn(async () => true)
    });

    expect(profiles.map(({ name, shellFamily, recommended }) => ({
      name,
      shellFamily,
      recommended
    }))).toEqual([
      { name: 'PowerShell 7', shellFamily: 'pwsh', recommended: true },
      { name: 'Windows PowerShell', shellFamily: 'powershell', recommended: false },
      { name: 'Command Prompt', shellFamily: 'cmd', recommended: false }
    ]);
  });

  it('prefers a valid Unix SHELL and removes duplicate paths', async () => {
    const findExecutable = vi.fn(async (name: string) => ({
      zsh: '/bin/zsh',
      bash: '/bin/bash',
      fish: null
    })[name] ?? null);

    const profiles = await detectTerminalProfiles({
      platform: 'darwin',
      env: { SHELL: '/bin/zsh' },
      findExecutable,
      isExecutablePath: vi.fn(async (path) => path === '/bin/zsh')
    });

    expect(profiles.map((item) => item.executablePath)).toEqual([
      '/bin/zsh',
      '/bin/bash'
    ]);
    expect(profiles[0]).toMatchObject({
      name: 'zsh',
      shellFamily: 'zsh',
      recommended: true
    });
  });

  it('ignores a relative or unavailable SHELL and uses Linux ordering', async () => {
    const findExecutable = vi.fn(async (name: string) => ({
      bash: '/usr/bin/bash',
      zsh: null,
      fish: '/usr/bin/fish'
    })[name] ?? null);

    const profiles = await detectTerminalProfiles({
      platform: 'linux',
      env: { SHELL: 'relative/bash' },
      findExecutable,
      isExecutablePath: vi.fn(async () => false)
    });

    expect(profiles.map((item) => item.shellFamily)).toEqual(['bash', 'fish']);
    expect(profiles[0]?.recommended).toBe(true);
  });

  it('produces stable IDs and no recommendation when nothing is found', async () => {
    let bashAvailable = false;
    const dependencies = {
      platform: 'linux' as const,
      env: {},
      findExecutable: vi.fn(
        async (name: string): Promise<string | null> =>
          bashAvailable && name === 'bash' ? '/bin/bash' : null
      ),
      isExecutablePath: vi.fn(async () => false)
    };

    await expect(detectTerminalProfiles(dependencies)).resolves.toEqual([]);

    bashAvailable = true;
    const first = await detectTerminalProfiles(dependencies);
    const second = await detectTerminalProfiles(dependencies);
    expect(first[0]?.id).toMatch(/^[a-f0-9]{64}$/);
    expect(second[0]?.id).toBe(first[0]?.id);
  });
});
