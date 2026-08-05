import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_GENERAL_SETTINGS,
  IPC_CHANNELS,
  type LumoraWindowContext
} from '../../shared/contracts';
import { registerAppearanceIpc } from './register-appearance-ipc';

type Handler = (
  event: { senderFrame: { url: string } | null }
) => Promise<unknown> | unknown;

function createHarness(
  cancelled = false,
  context: LumoraWindowContext = { mode: 'local', executionTargetId: 'local' }
) {
  const handlers = new Map<string, Handler>();
  const service = {
    getState: vi.fn().mockResolvedValue({ available: false, revision: null }),
    importFrom: vi.fn().mockResolvedValue({
      available: true,
      revision: '1720000000000-4096'
    }),
    remove: vi.fn().mockResolvedValue({ available: false, revision: null })
  };
  registerAppearanceIpc({
    authorizeRead: () => context,
    authorizeWrite: () => {
      if (context.mode !== 'local') throw new Error('local only');
      return context;
    },
    ipc: { handle: (channel, handler) => handlers.set(channel, handler) },
    service,
    getAppearanceSettings: () => DEFAULT_GENERAL_SETTINGS.appearance,
    showOpenDialog: vi.fn().mockResolvedValue(
      cancelled ? { canceled: true, filePaths: [] } : {
        canceled: false,
        filePaths: ['D:\\Pictures\\background.webp']
      }
    )
  });
  return { handlers, service };
}

const trustedEvent = { senderFrame: { url: 'app://lumora/index.html' } };

describe('registerAppearanceIpc', () => {
  it('chooses one supported image and imports only its opaque path', async () => {
    const { handlers, service } = createHarness();
    await expect(
      handlers.get(IPC_CHANNELS.appearanceBackgroundChoose)!(trustedEvent)
    ).resolves.toEqual({
      available: true,
      revision: '1720000000000-4096'
    });
    expect(service.importFrom).toHaveBeenCalledWith(
      'D:\\Pictures\\background.webp'
    );
  });

  it('returns current state when selection is cancelled', async () => {
    const { handlers, service } = createHarness(true);
    await expect(
      handlers.get(IPC_CHANNELS.appearanceBackgroundChoose)!(trustedEvent)
    ).resolves.toEqual({ available: false, revision: null });
    expect(service.importFrom).not.toHaveBeenCalled();
  });

  it('rejects untrusted renderers before opening native UI', async () => {
    const { handlers } = createHarness();
    await expect(
      handlers.get(IPC_CHANNELS.appearanceBackgroundGet)!({
        senderFrame: { url: 'https://example.com' }
      })
    ).rejects.toMatchObject({ code: 'IPC_UNTRUSTED_SENDER' });
  });

  it('lets a trusted remote window read global presentation but not mutate it', async () => {
    const { handlers } = createHarness(false, {
      mode: 'remote',
      executionTargetId: '5dd607fb-cd81-4a17-bb5f-0fba91ad631f'
    });

    await expect(
      handlers.get(IPC_CHANNELS.appearancePresentationGet)!(trustedEvent)
    ).resolves.toEqual({
      appearance: DEFAULT_GENERAL_SETTINGS.appearance,
      background: { available: false, revision: null }
    });
    await expect(
      handlers.get(IPC_CHANNELS.appearanceBackgroundChoose)!(trustedEvent)
    ).rejects.toBeDefined();
  });
});
