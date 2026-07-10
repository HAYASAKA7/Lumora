import { describe, expect, it } from 'vitest';

import { IPC_CHANNELS, SystemInfoSchema } from '../../shared/contracts';
import { registerSystemIpc } from './register-system-ipc';

interface InvokeEventStub {
  senderFrame: { url: string } | null;
}

type InvokeHandler = (event: InvokeEventStub) => Promise<unknown> | unknown;

function createHarness(developmentOrigin?: string) {
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
    ...(developmentOrigin === undefined ? {} : { developmentOrigin })
  });

  const handler = handlers.get(IPC_CHANNELS.systemInfo);
  if (handler === undefined) {
    throw new Error('System info handler was not registered');
  }

  return { handler, registeredChannels: [...handlers.keys()] };
}

describe('registerSystemIpc', () => {
  it('registers only the system-info operation and returns a validated payload', async () => {
    const { handler, registeredChannels } = createHarness();

    expect(registeredChannels).toEqual([IPC_CHANNELS.systemInfo]);

    const result = await handler({
      senderFrame: { url: 'app://lumora/index.html' }
    });

    expect(SystemInfoSchema.parse(result)).toEqual({
      platform: 'win32',
      arch: 'x64',
      appVersion: '0.1.0'
    });
  });

  it('accepts only the exact development origin supplied at startup', async () => {
    const { handler } = createHarness('http://localhost:5173');

    await expect(
      handler({ senderFrame: { url: 'http://localhost:5173/src/main.tsx' } })
    ).resolves.toEqual({
      platform: 'win32',
      arch: 'x64',
      appVersion: '0.1.0'
    });

    await expect(
      handler({ senderFrame: { url: 'http://localhost:4173/index.html' } })
    ).rejects.toMatchObject({ code: 'IPC_UNTRUSTED_SENDER' });
  });

  it('rejects remote and missing sender frames with a stable error code', async () => {
    const { handler } = createHarness();

    await expect(
      handler({ senderFrame: { url: 'https://example.com/index.html' } })
    ).rejects.toMatchObject({ code: 'IPC_UNTRUSTED_SENDER' });

    await expect(handler({ senderFrame: null })).rejects.toMatchObject({
      code: 'IPC_UNTRUSTED_SENDER'
    });
  });
});
