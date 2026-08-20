import { describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '../../shared/contracts';
import { registerAboutIpc } from './register-about-ipc';

describe('registerAboutIpc', () => {
  it('serves both target windows and opens only fixed validated URLs', async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const authorize = vi.fn().mockReturnValue({ mode: 'remote', executionTargetId: 'remote' });
    const openProject = vi.fn().mockResolvedValue(undefined);
    const release = {
      getStatus: vi.fn().mockResolvedValue({
        state: 'current', installedVersion: '0.3.5', latestVersion: '0.3.5'
      }),
      openAvailableRelease: vi.fn().mockResolvedValue({ opened: true })
    };
    registerAboutIpc({
      ipc: { handle: (channel, handler) => handlers.set(channel, handler) },
      authorize,
      platform: 'linux',
      arch: 'x64',
      appVersion: '0.3.5',
      release,
      openProject
    });
    const event = { senderFrame: { url: 'file:///app/index.html' }, sender: { id: 1 } };

    expect(handlers.get(IPC_CHANNELS.applicationAboutGet)!(event)).toMatchObject({
      productName: 'Lumora', developer: 'HAYASAKA7',
      system: { platform: 'linux', arch: 'x64', appVersion: '0.3.5' }
    });
    await handlers.get(IPC_CHANNELS.applicationProjectOpen)!(event);
    expect(openProject).toHaveBeenCalledWith('https://github.com/HAYASAKA7/Lumora');
    await handlers.get(IPC_CHANNELS.applicationReleaseOpen)!(event, 'https://evil.test');
    expect(release.openAvailableRelease).toHaveBeenCalledWith();
    expect(authorize).toHaveBeenCalled();
  });
});
