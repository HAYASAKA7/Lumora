import { describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '../../shared/contracts';
import {
  NODE_DOWNLOAD_URL,
  registerEnvironmentIpc
} from './register-environment-ipc';

interface InvokeEventStub {
  senderFrame: { url: string } | null;
}

type InvokeHandler = (
  event: InvokeEventStub,
  ...args: readonly unknown[]
) => Promise<unknown> | unknown;

const scan = {
  checkedAt: '2026-07-17T01:00:00.000Z',
  node: {
    state: 'ready',
    executablePath: '/usr/bin/node',
    version: 'v24.18.0'
  },
  npm: {
    state: 'ready',
    executablePath: '/usr/bin/npm',
    version: '11.6.2'
  }
} as const;

function createHarness(developmentOrigin?: string) {
  const handlers = new Map<string, InvokeHandler>();
  const scanner = { scan: vi.fn().mockResolvedValue(scan) };
  const resolveScanner = vi.fn(() => scanner);
  const openExternal = vi.fn().mockResolvedValue(undefined);
  registerEnvironmentIpc({
    authorize: () => ({ mode: 'local', executionTargetId: 'local' }),
    ipc: {
      handle(channel: string, handler: InvokeHandler) {
        handlers.set(channel, handler);
      }
    },
    resolveScanner,
    openExternal,
    ...(developmentOrigin === undefined ? {} : { developmentOrigin })
  });

  return { handlers, scanner, resolveScanner, openExternal };
}

describe('registerEnvironmentIpc', () => {
  it('registers only narrow scan and fixed-download operations', async () => {
    const { handlers, scanner, resolveScanner, openExternal } = createHarness();
    expect([...handlers.keys()]).toEqual([
      IPC_CHANNELS.environmentScan,
      IPC_CHANNELS.nodeDownloadOpen
    ]);
    const event = { senderFrame: { url: 'app://lumora/index.html' } };

    await expect(handlers.get(IPC_CHANNELS.environmentScan)!(event)).resolves.toEqual(
      scan
    );
    await expect(
      handlers.get(IPC_CHANNELS.nodeDownloadOpen)!(event, 'https://evil.example')
    ).resolves.toEqual({ opened: true });

    expect(resolveScanner).toHaveBeenCalledWith({
      mode: 'local',
      executionTargetId: 'local'
    });
    expect(scanner.scan).toHaveBeenCalledOnce();
    expect(openExternal).toHaveBeenCalledOnce();
    expect(openExternal).toHaveBeenCalledWith(NODE_DOWNLOAD_URL);
    expect(NODE_DOWNLOAD_URL).toBe('https://nodejs.org/en/download');
  });

  it('accepts only the exact configured development origin', async () => {
    const { handlers } = createHarness('http://localhost:5173');
    const handler = handlers.get(IPC_CHANNELS.environmentScan)!;

    await expect(
      handler({ senderFrame: { url: 'http://localhost:5173/src/main.tsx' } })
    ).resolves.toEqual(scan);
    await expect(
      handler({ senderFrame: { url: 'http://localhost:4173/index.html' } })
    ).rejects.toMatchObject({ code: 'IPC_UNTRUSTED_SENDER' });
  });

  it('does not scan or open a browser for untrusted senders', async () => {
    const { handlers, scanner, openExternal } = createHarness();
    const scanHandler = handlers.get(IPC_CHANNELS.environmentScan)!;
    const downloadHandler = handlers.get(IPC_CHANNELS.nodeDownloadOpen)!;

    await expect(
      scanHandler({ senderFrame: { url: 'https://example.com' } })
    ).rejects.toMatchObject({ code: 'IPC_UNTRUSTED_SENDER' });
    await expect(downloadHandler({ senderFrame: null })).rejects.toMatchObject({
      code: 'IPC_UNTRUSTED_SENDER'
    });
    expect(scanner.scan).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });
});
