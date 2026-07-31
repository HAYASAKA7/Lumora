import { describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '../../shared/contracts';
import { registerAppearanceIpc } from './register-appearance-ipc';

type Handler = (
  event: { senderFrame: { url: string } | null }
) => Promise<unknown> | unknown;

function createHarness(cancelled = false) {
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
    ipc: { handle: (channel, handler) => handlers.set(channel, handler) },
    service,
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
});
