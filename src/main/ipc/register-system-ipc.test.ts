import { describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS, SystemInfoSchema } from '../../shared/contracts';
import { registerSystemIpc } from './register-system-ipc';

interface InvokeEventStub {
  senderFrame: { url: string } | null;
  sender: { id: number };
}

type InvokeHandler = (event: InvokeEventStub) => Promise<unknown> | unknown;

function createHarness(
  developmentOrigin?: string,
  claimStartupPresentation = vi.fn().mockResolvedValue(true),
  completeStartupPresentation = vi.fn()
) {
  const handlers = new Map<string, InvokeHandler>();
  const ipc = {
    handle(channel: string, handler: InvokeHandler) {
      handlers.set(channel, handler);
    }
  };

  registerSystemIpc({
    authorize: () => ({ mode: 'local', executionTargetId: 'local' }),
    ipc,
    platform: 'win32',
    arch: 'x64',
    appVersion: '0.1.0',
    claimStartupPresentation,
    completeStartupPresentation,
    ...(developmentOrigin === undefined ? {} : { developmentOrigin })
  });

  const systemInfoHandler = handlers.get(IPC_CHANNELS.systemInfo);
  const startupPresentationClaimHandler = handlers.get(
    IPC_CHANNELS.startupPresentationClaim
  );
  const startupPresentationCompleteHandler = handlers.get(
    IPC_CHANNELS.startupPresentationComplete
  );
  if (
    systemInfoHandler === undefined ||
    startupPresentationClaimHandler === undefined ||
    startupPresentationCompleteHandler === undefined
  ) {
    throw new Error('System handlers were not registered');
  }

  return {
    claimStartupPresentation,
    completeStartupPresentation,
    registeredChannels: [...handlers.keys()],
    startupPresentationClaimHandler,
    startupPresentationCompleteHandler,
    systemInfoHandler
  };
}

describe('registerSystemIpc', () => {
  it('registers only the system-info operation and returns a validated payload', async () => {
    const { systemInfoHandler, registeredChannels } = createHarness();

    expect(registeredChannels).toEqual([
      IPC_CHANNELS.systemInfo,
      IPC_CHANNELS.startupPresentationClaim,
      IPC_CHANNELS.startupPresentationComplete
    ]);

    const result = await systemInfoHandler({
      sender: { id: 7 },
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
      systemInfoHandler({
        sender: { id: 7 },
        senderFrame: { url: 'http://localhost:5173/src/main.tsx' }
      })
    ).resolves.toEqual({
      platform: 'win32',
      arch: 'x64',
      appVersion: '0.1.0'
    });

    await expect(
      systemInfoHandler({
        sender: { id: 7 },
        senderFrame: { url: 'http://localhost:4173/index.html' }
      })
    ).rejects.toMatchObject({ code: 'IPC_UNTRUSTED_SENDER' });
  });

  it('rejects remote and missing sender frames with a stable error code', async () => {
    const { systemInfoHandler } = createHarness();

    await expect(
      systemInfoHandler({
        sender: { id: 7 },
        senderFrame: { url: 'https://example.com/index.html' }
      })
    ).rejects.toMatchObject({ code: 'IPC_UNTRUSTED_SENDER' });

    await expect(
      systemInfoHandler({
        sender: { id: 7 },
        senderFrame: null
      })
    ).rejects.toMatchObject({
      code: 'IPC_UNTRUSTED_SENDER'
    });
  });

  it('returns the startup presentation claim only to trusted renderers', async () => {
    const {
      claimStartupPresentation,
      startupPresentationClaimHandler
    } = createHarness();

    await expect(
      startupPresentationClaimHandler({
        sender: { id: 17 },
        senderFrame: { url: 'app://lumora/index.html' }
      })
    ).resolves.toBe(true);
    expect(claimStartupPresentation).toHaveBeenCalledWith(17);

    await expect(
      startupPresentationClaimHandler({
        sender: { id: 18 },
        senderFrame: { url: 'https://example.com/index.html' }
      })
    ).rejects.toMatchObject({ code: 'IPC_UNTRUSTED_SENDER' });
    expect(claimStartupPresentation).toHaveBeenCalledTimes(1);
  });

  it('reports startup completion only from trusted renderers', async () => {
    const {
      completeStartupPresentation,
      startupPresentationCompleteHandler
    } = createHarness();

    await expect(
      startupPresentationCompleteHandler({
        sender: { id: 17 },
        senderFrame: { url: 'app://lumora/index.html' }
      })
    ).resolves.toEqual({ acknowledged: true });
    expect(completeStartupPresentation).toHaveBeenCalledWith(17);

    await expect(
      startupPresentationCompleteHandler({
        sender: { id: 18 },
        senderFrame: { url: 'https://example.com/index.html' }
      })
    ).rejects.toMatchObject({ code: 'IPC_UNTRUSTED_SENDER' });
    expect(completeStartupPresentation).toHaveBeenCalledTimes(1);
  });
});
