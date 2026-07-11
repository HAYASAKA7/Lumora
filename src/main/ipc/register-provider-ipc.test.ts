import { describe, expect, it } from 'vitest';

import {
  IPC_CHANNELS,
  ProviderScanResultSchema,
  type ProviderScanResult
} from '../../shared/contracts';
import { registerProviderIpc } from './register-provider-ipc';

interface InvokeEventStub {
  senderFrame: { url: string } | null;
}

type InvokeHandler = (event: InvokeEventStub) => Promise<unknown> | unknown;

const validScan: ProviderScanResult = {
  scannedAt: '2026-07-11T01:02:03.000Z',
  providers: [
    {
      provider: 'codex',
      displayName: 'Codex',
      state: 'ready',
      executablePath: '/tools/codex',
      version: 'codex-cli 1.2.3',
      issue: null
    },
    {
      provider: 'claude',
      displayName: 'Claude Code',
      state: 'not_found',
      executablePath: null,
      version: null,
      issue: {
        code: 'PROVIDER_NOT_FOUND',
        message: 'Claude Code was not found on PATH.',
        recovery: 'Install Claude Code or add it to PATH, then refresh.',
        retryable: true
      }
    }
  ]
};

function createHarness(
  scan: () => Promise<unknown> = async () => validScan,
  developmentOrigin?: string
) {
  const handlers = new Map<string, InvokeHandler>();
  const ipc = {
    handle(channel: string, handler: InvokeHandler) {
      handlers.set(channel, handler);
    }
  };

  registerProviderIpc({
    ipc,
    registry: { scan },
    ...(developmentOrigin === undefined ? {} : { developmentOrigin })
  });

  const handler = handlers.get(IPC_CHANNELS.providerScan);
  if (handler === undefined) {
    throw new Error('Provider scan handler was not registered');
  }

  return { handler, registeredChannels: [...handlers.keys()] };
}

describe('registerProviderIpc', () => {
  it('registers one scan operation and validates its response', async () => {
    const { handler, registeredChannels } = createHarness();

    expect(registeredChannels).toEqual([IPC_CHANNELS.providerScan]);
    const result = await handler({
      senderFrame: { url: 'app://lumora/index.html' }
    });
    expect(ProviderScanResultSchema.parse(result)).toEqual(validScan);
  });

  it('accepts only the exact development origin supplied at startup', async () => {
    const { handler } = createHarness(
      async () => validScan,
      'http://localhost:5173'
    );

    await expect(
      handler({ senderFrame: { url: 'http://localhost:5173/src/main.tsx' } })
    ).resolves.toEqual(validScan);

    await expect(
      handler({ senderFrame: { url: 'http://localhost:4173/index.html' } })
    ).rejects.toMatchObject({ code: 'IPC_UNTRUSTED_SENDER' });
  });

  it('rejects remote and missing sender frames before scanning', async () => {
    let scanCount = 0;
    const { handler } = createHarness(async () => {
      scanCount += 1;
      return validScan;
    });

    await expect(
      handler({ senderFrame: { url: 'https://example.com/index.html' } })
    ).rejects.toMatchObject({ code: 'IPC_UNTRUSTED_SENDER' });
    await expect(handler({ senderFrame: null })).rejects.toMatchObject({
      code: 'IPC_UNTRUSTED_SENDER'
    });
    expect(scanCount).toBe(0);
  });

  it('rejects malformed registry data before it crosses IPC', async () => {
    const { handler } = createHarness(async () => ({
      ...validScan,
      providers: [{ ...validScan.providers[0], environment: process.env }]
    }));

    await expect(
      handler({ senderFrame: { url: 'app://lumora/index.html' } })
    ).rejects.toBeDefined();
  });
});
