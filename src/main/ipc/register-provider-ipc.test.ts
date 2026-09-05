import { describe, expect, it, vi } from 'vitest';

import {
  IPC_CHANNELS,
  ProviderScanResultSchema,
  ProviderUpdateCheckResultSchema,
  type ProviderId,
  type ProviderScanResult
} from '../../shared/contracts';
import { registerProviderIpc } from './register-provider-ipc';

interface InvokeEventStub {
  senderFrame: { url: string } | null;
}

type InvokeHandler = (
  event: InvokeEventStub,
  ...args: readonly unknown[]
) => Promise<unknown> | unknown;

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

const validUpdateCheck = {
  checkedAt: '2026-07-17T02:00:00.000Z',
  providers: [
    {
      provider: 'codex' as const,
      displayName: 'Codex',
      state: 'update_available' as const,
      installedVersion: '1.2.3',
      latestVersion: '1.3.0',
      issue: null
    },
    {
      provider: 'claude' as const,
      displayName: 'Claude Code',
      state: 'unavailable' as const,
      installedVersion: null,
      latestVersion: null,
      issue: {
        code: 'PROVIDER_NOT_READY' as const,
        message: 'Claude Code is not ready.',
        recovery: 'Install Claude Code, then refresh.',
        retryable: true
      }
    }
  ]
};

function createHarness(
  scan: () => Promise<unknown> = async () => validScan,
  developmentOrigin?: string,
  check: () => Promise<unknown> = async () => validUpdateCheck,
  update: (provider: ProviderId) => Promise<unknown> = async (provider) => ({
    provider,
    completedAt: '2026-07-17T02:01:00.000Z',
    installation: validScan.providers.find(
      (installation) => installation.provider === provider
    )
  }),
  install: (provider: ProviderId) => Promise<unknown> = update,
  openExternal: (url: string) => Promise<unknown> = async () => undefined,
  cancel: (provider: ProviderId) => boolean = () => true
) {
  const handlers = new Map<string, InvokeHandler>();
  const ipc = {
    handle(channel: string, handler: InvokeHandler) {
      handlers.set(channel, handler);
    }
  };

  const resolveServices = vi.fn(() => ({
    registry: { scan },
    updates: { check, update, install, cancel }
  }));

  registerProviderIpc({
    authorize: () => ({ mode: 'local', executionTargetId: 'local' }),
    ipc,
    resolveServices,
    openExternal,
    ...(developmentOrigin === undefined ? {} : { developmentOrigin })
  });

  const handler = handlers.get(IPC_CHANNELS.providerScan);
  if (handler === undefined) {
    throw new Error('Provider scan handler was not registered');
  }

  return {
    handler, handlers, resolveServices,
    registeredChannels: [...handlers.keys()]
  };
}

const trustedEvent = { senderFrame: { url: 'app://lumora/index.html' } };

describe('registerProviderIpc', () => {
  /**
   * A refresh that answers from the cache is why a provider that failed once
   * stayed missing: the button returned at once and nothing was re-probed.
   */
  it('re-probes when the renderer asks for a fresh scan', async () => {
    const scan = vi.fn(async () => validScan);
    const scanFresh = vi.fn(async () => validScan);
    const handlers = new Map<string, InvokeHandler>();
    registerProviderIpc({
      authorize: () => ({ mode: 'local', executionTargetId: 'local' }),
      ipc: {
        handle(channel: string, handler: InvokeHandler) {
          handlers.set(channel, handler);
        }
      },
      resolveServices: () => ({
        registry: { scan, scanFresh },
        updates: {
          check: async () => ({
            checkedAt: '2026-07-17T02:00:00.000Z',
            providers: []
          }),
          update: async () => undefined,
          install: async () => undefined,
          cancel: () => true
        }
      }),
      openExternal: async () => undefined
    });
    const scanHandler = handlers.get(IPC_CHANNELS.providerScan)!;

    await scanHandler(trustedEvent);
    expect(scan).toHaveBeenCalledOnce();
    expect(scanFresh).not.toHaveBeenCalled();

    await scanHandler(trustedEvent, { fresh: true });
    expect(scanFresh).toHaveBeenCalledOnce();
    expect(scan).toHaveBeenCalledOnce();
  });

  it('rejects a scan request that is not the agreed shape', async () => {
    const { handler } = createHarness();

    await expect(handler(trustedEvent, { fresh: 'yes' })).rejects.toThrow();
    await expect(handler(trustedEvent, { refresh: true })).rejects.toThrow();
  });

  it('registers one scan operation and validates its response', async () => {
    const { handler, registeredChannels, resolveServices } = createHarness();

    expect(registeredChannels).toEqual([
      IPC_CHANNELS.providerScan,
      IPC_CHANNELS.providerUpdateCancel,
      IPC_CHANNELS.providerUpdatesCheck,
      IPC_CHANNELS.providerUpdateRun,
      IPC_CHANNELS.providerInstallRun,
      IPC_CHANNELS.providerInstallGuideOpen
    ]);
    const result = await handler({
      senderFrame: { url: 'app://lumora/index.html' }
    });
    expect(ProviderScanResultSchema.parse(result)).toEqual(validScan);
    expect(resolveServices).toHaveBeenCalledWith({
      mode: 'local',
      executionTargetId: 'local'
    });
  });

  it('installs validated providers and opens only shipped guide URLs', async () => {
    const install = vi.fn(async (provider: ProviderId) => ({
      provider,
      completedAt: '2026-07-17T02:02:00.000Z',
      installation: {
        provider,
        displayName: 'Gemini CLI',
        state: 'ready',
        executablePath: '/usr/bin/gemini',
        version: '1.2.3',
        issue: null
      }
    }));
    const openExternal = vi.fn(async () => undefined);
    const { handlers } = createHarness(
      async () => validScan,
      undefined,
      async () => validUpdateCheck,
      undefined,
      install,
      openExternal
    );
    const event = { senderFrame: { url: 'app://lumora/index.html' } };

    await expect(
      handlers.get(IPC_CHANNELS.providerInstallRun)!(event, {
        provider: 'gemini'
      })
    ).resolves.toMatchObject({ outcome: 'completed', result: { provider: 'gemini' } });
    await expect(
      handlers.get(IPC_CHANNELS.providerInstallGuideOpen)!(event, {
        provider: 'aider'
      })
    ).resolves.toEqual({ opened: true });
    expect(install).toHaveBeenCalledWith('gemini');
    expect(openExternal).toHaveBeenCalledWith(
      'https://aider.chat/docs/install.html'
    );

    await expect(
      handlers.get(IPC_CHANNELS.providerInstallGuideOpen)!(event, {
        provider: 'unknown-agent',
        url: 'https://evil.example'
      })
    ).rejects.toBeDefined();
    expect(openExternal).toHaveBeenCalledOnce();
  });

  it('validates update checks and accepts only a provider ID for execution', async () => {
    const update = vi.fn(async (provider: ProviderId) => ({
      provider,
      completedAt: '2026-07-17T02:01:00.000Z',
      installation: validScan.providers[0]
    }));
    const { handlers } = createHarness(
      async () => validScan,
      undefined,
      async () => validUpdateCheck,
      update
    );
    const event = { senderFrame: { url: 'app://lumora/index.html' } };

    const checkResult = await handlers.get(IPC_CHANNELS.providerUpdatesCheck)!(
      event
    );
    expect(ProviderUpdateCheckResultSchema.parse(checkResult)).toEqual(
      validUpdateCheck
    );
    await expect(
      handlers.get(IPC_CHANNELS.providerUpdateRun)!(event, {
        provider: 'codex'
      })
    ).resolves.toMatchObject({ outcome: 'completed', result: { provider: 'codex' } });
    expect(update).toHaveBeenCalledWith('codex');

    await expect(
      handlers.get(IPC_CHANNELS.providerUpdateRun)!(event, {
        provider: 'codex',
        executablePath: '/tmp/codex'
      })
    ).rejects.toBeDefined();
    expect(update).toHaveBeenCalledOnce();
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

  it('stops a running installation and reports whether there was one', async () => {
    const cancel = vi.fn(() => true);
    const { handlers } = createHarness(
      undefined, undefined, undefined, undefined, undefined, undefined, cancel
    );
    const handler = handlers.get(IPC_CHANNELS.providerUpdateCancel)!;

    expect(await handler(trustedEvent, { provider: 'codex' }))
      .toEqual({ cancelled: true });
    expect(cancel).toHaveBeenCalledWith('codex');
    await expect(handler(trustedEvent, { provider: 'not-a-provider' }))
      .rejects.toThrow();
  });

  /**
   * npm's own output can carry registry credentials, so the renderer receives
   * only the classified code.
   */
  it('passes a lifecycle code to the renderer without npm output', async () => {
    const { handlers } = createHarness(undefined, undefined, undefined, async () => {
      throw Object.assign(new Error('npm error //registry/:_authToken=secret'), {
        code: 'PROVIDER_LIFECYCLE_BUSY'
      });
    });

    await expect(
      handlers.get(IPC_CHANNELS.providerUpdateRun)!(
        trustedEvent, { provider: 'codex' }
      )
    ).rejects.toThrow('PROVIDER_LIFECYCLE_BUSY');
    await expect(
      handlers.get(IPC_CHANNELS.providerUpdateRun)!(
        trustedEvent, { provider: 'codex' }
      )
    ).rejects.not.toThrow('_authToken');
  });

  /**
   * Electron logs every rejected handler, so a cancellation the user asked for
   * must not travel as a failure.
   */
  it('resolves a cancelled update instead of rejecting it', async () => {
    const { handlers } = createHarness(undefined, undefined, undefined, async () => {
      throw Object.assign(new Error('stopped'), {
        code: 'PROVIDER_LIFECYCLE_CANCELLED'
      });
    });

    await expect(
      handlers.get(IPC_CHANNELS.providerUpdateRun)!(
        trustedEvent, { provider: 'codex' }
      )
    ).resolves.toEqual({ outcome: 'cancelled' });
  });

  it('reports a completed update as a completed outcome', async () => {
    const { handlers } = createHarness();

    expect(
      await handlers.get(IPC_CHANNELS.providerUpdateRun)!(
        trustedEvent, { provider: 'codex' }
      )
    ).toMatchObject({ outcome: 'completed', result: { provider: 'codex' } });
  });
});