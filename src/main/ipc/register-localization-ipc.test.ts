import { describe, expect, it, vi } from 'vitest';

import {
  IPC_CHANNELS,
  type LocalizationSnapshot,
  type LumoraWindowContext
} from '../../shared/contracts';
import { registerLocalizationIpc } from './register-localization-ipc';

type Event = { senderFrame: { url: string } | null };
type Handler = (event: Event) => Promise<unknown> | unknown;

const snapshot: LocalizationSnapshot = {
  revision: 1,
  preference: 'system',
  locale: 'en',
  formattingLocale: 'en-US',
  direction: 'ltr',
  availableLocales: [{
    locale: 'en',
    displayName: 'English',
    direction: 'ltr',
    sources: ['bundled'],
    catalogVersion: 1
  }],
  messages: { 'common.actions.cancel': 'Cancel' },
  warnings: []
};
const trustedEvent: Event = { senderFrame: { url: 'app://lumora/index.html' } };
const modsSettings = {
  rootPath: 'D:\\Lumora Mods',
  localesPath: 'D:\\Lumora Mods\\locales',
  usesDefault: false
};

function harness(
  context: LumoraWindowContext = { mode: 'local', executionTargetId: 'local' }
) {
  const handlers = new Map<string, Handler>();
  let subscribed: ((value: LocalizationSnapshot) => void) | null = null;
  const unsubscribe = vi.fn();
  const broadcast = vi.fn();
  const service = {
    getSnapshot: vi.fn(() => snapshot),
    reload: vi.fn(() => ({
      snapshot,
      loadedUserPacks: 0,
      rejectedUserPacks: 0
    })),
    subscribe: vi.fn((listener: (value: LocalizationSnapshot) => void) => {
      subscribed = listener;
      return unsubscribe;
    })
  };
  const dispose = registerLocalizationIpc({
    ipc: { handle: (channel, handler) => handlers.set(channel, handler) },
    authorize: () => context,
    service,
    openUserLocaleFolder: vi.fn().mockResolvedValue(undefined),
    getModsSettings: vi.fn().mockResolvedValue(modsSettings),
    chooseModsRoot: vi.fn().mockResolvedValue({
      canceled: false,
      settings: modsSettings
    }),
    resetModsRoot: vi.fn().mockResolvedValue({
      ...modsSettings,
      usesDefault: true
    }),
    openModsRoot: vi.fn().mockResolvedValue(undefined),
    broadcast
  });
  return { handlers, service, broadcast, dispose, unsubscribe, publish: () => {
    const listener = subscribed as unknown as (value: LocalizationSnapshot) => void;
    listener(snapshot);
  } };
}

describe('registerLocalizationIpc', () => {
  it('serves validated snapshots and reload results to local and remote windows', async () => {
    for (const context of [
      { mode: 'local', executionTargetId: 'local' },
      {
        mode: 'remote',
        executionTargetId: '5dd607fb-cd81-4a17-bb5f-0fba91ad631f'
      }
    ] as const) {
      const { handlers } = harness(context);
      await expect(
        handlers.get(IPC_CHANNELS.localizationSnapshotGet)!(trustedEvent)
      ).resolves.toEqual(snapshot);
      await expect(
        handlers.get(IPC_CHANNELS.localizationReload)!(trustedEvent)
      ).resolves.toMatchObject({ snapshot, loadedUserPacks: 0 });
      await expect(
        handlers.get(IPC_CHANNELS.localizationUserFolderOpen)!(trustedEvent)
      ).resolves.toEqual({ opened: true });
      await expect(
        handlers.get(IPC_CHANNELS.modsSettingsGet)!(trustedEvent)
      ).resolves.toEqual(modsSettings);
      await expect(
        handlers.get(IPC_CHANNELS.modsRootChoose)!(trustedEvent)
      ).resolves.toEqual({ canceled: false, settings: modsSettings });
      await expect(
        handlers.get(IPC_CHANNELS.modsRootOpen)!(trustedEvent)
      ).resolves.toEqual({ opened: true });
    }
  });

  it('rejects untrusted renderers and sanitizes operation failures', async () => {
    const { handlers, service } = harness();
    await expect(
      handlers.get(IPC_CHANNELS.localizationSnapshotGet)!({
        senderFrame: { url: 'https://example.com' }
      })
    ).rejects.toMatchObject({ code: 'IPC_UNTRUSTED_SENDER' });
    service.reload.mockImplementation(() => {
      throw new Error('D:\\Private\\locales\\broken.json');
    });
    await expect(
      handlers.get(IPC_CHANNELS.localizationReload)!(trustedEvent)
    ).rejects.toMatchObject({
      code: 'LOCALIZATION_OPERATION_FAILED',
      message: expect.not.stringContaining('D:\\Private')
    });
  });

  it('broadcasts validated changes and disposes its service listener', () => {
    const { publish, broadcast, dispose, unsubscribe } = harness();
    publish();
    expect(broadcast).toHaveBeenCalledWith(snapshot);
    dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
