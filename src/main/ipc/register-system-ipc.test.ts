import { describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS, SystemInfoSchema } from '../../shared/contracts';
import { registerSystemIpc } from './register-system-ipc';

interface InvokeEventStub {
  senderFrame: { url: string } | null;
}

type InvokeHandler = (event: InvokeEventStub) => Promise<unknown> | unknown;

function createHarness(
  developmentOrigin?: string,
  claimStartupPresentation = vi.fn().mockResolvedValue(true)
) {
  const handlers = new Map<string, InvokeHandler>();
  const ipc = {
    handle(channel: string, handler: InvokeHandler) {
      handlers.set(channel, handler);
    }
  };

  registerSystemIpc({
    ipc,
    platform: 'win32',
    arch: 'x64',
    appVersion: '0.1.0',
    claimStartupPresentation,
    ...(developmentOrigin === undefined ? {} : { developmentOrigin })
  });

  const systemInfoHandler = handlers.get(IPC_CHANNELS.systemInfo);
  const startupPresentationHandler = handlers.get(
    IPC_CHANNELS.startupPresentationClaim
  );
  if (systemInfoHandler === undefined || startupPresentationHandler === undefined) {
    throw new Error('System handlers were not registered');
  }

  return {
    claimStartupPresentation,
    registeredChannels: [...handlers.keys()],
    startupPresentationHandler,
    systemInfoHandler
  };
}

describe('registerSystemIpc', () => {
  it('registers only the system-info operation and returns a validated payload', async () => {
    const { systemInfoHandler, registeredChannels } = createHarness();

    expect(registeredChannels).toEqual([
      IPC_CHANNELS.systemInfo,
      IPC_CHANNELS.startupPresentationClaim
    ]);

    const result = await systemInfoHandler({
      senderFrame: { url: 'app://lumora/index.html' }
    });

    expect(SystemInfoSchema.parse(result)).toEqual({
      platform: 'win32',
      arch: 'x64',
      appVersion: '0.1.0'
    });
  });

  it('accepts only the exact development origin supplied at startup', async () => {
    const { systemInfoHandler } = createHarness('http://localhost:5173');

    await expect(
      systemInfoHandler({ senderFrame: { url: 'http://localhost:5173/src/main.tsx' } })
    ).resolves.toEqual({
      platform: 'win32',
      arch: 'x64',
      appVersion: '0.1.0'
    });

    await expect(
      systemInfoHandler({ senderFrame: { url: 'http://localhost:4173/index.html' } })
    ).rejects.toMatchObject({ code: 'IPC_UNTRUSTED_SENDER' });
  });

  it('rejects remote and missing sender frames with a stable error code', async () => {
    const { systemInfoHandler } = createHarness();

    await expect(
      systemInfoHandler({ senderFrame: { url: 'https://example.com/index.html' } })
    ).rejects.toMatchObject({ code: 'IPC_UNTRUSTED_SENDER' });

    await expect(systemInfoHandler({ senderFrame: null })).rejects.toMatchObject({
      code: 'IPC_UNTRUSTED_SENDER'
    });
  });

  it('returns the startup presentation claim only to trusted renderers', async () => {
    const {
      claimStartupPresentation,
      startupPresentationHandler
    } = createHarness();

    await expect(
      startupPresentationHandler({
        senderFrame: { url: 'app://lumora/index.html' }
      })
    ).resolves.toBe(true);
    expect(claimStartupPresentation).toHaveBeenCalledTimes(1);

    await expect(
      startupPresentationHandler({
        senderFrame: { url: 'https://example.com/index.html' }
      })
    ).rejects.toMatchObject({ code: 'IPC_UNTRUSTED_SENDER' });
    expect(claimStartupPresentation).toHaveBeenCalledTimes(1);
  });
});
