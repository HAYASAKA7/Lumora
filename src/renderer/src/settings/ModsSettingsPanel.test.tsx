import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { LumoraApi } from '../../../shared/contracts';
import { renderWithLocalization } from '../test/render-with-localization';
import { ModsSettingsPanel } from './ModsSettingsPanel';

describe('ModsSettingsPanel', () => {
  it('loads, changes, opens, resets, and reloads the Mods locale directory', async () => {
    const managed = {
      rootPath: 'C:\\Users\\Lumora\\mods',
      localesPath: 'C:\\Users\\Lumora\\mods\\locales',
      fontsPath: 'C:\\Users\\Lumora\\mods\\fonts',
      usesDefault: true
    };
    const custom = {
      rootPath: 'D:\\My Mods',
      localesPath: 'D:\\My Mods\\locales',
      fontsPath: 'D:\\My Mods\\fonts',
      usesDefault: false
    };
    const api = {
      getModsSettings: vi.fn().mockResolvedValue(managed),
      chooseModsRoot: vi.fn().mockResolvedValue({
        canceled: false,
        settings: custom
      }),
      resetModsRoot: vi.fn().mockResolvedValue(managed),
      openModsRoot: vi.fn().mockResolvedValue(undefined),
      openUserLocaleFolder: vi.fn().mockResolvedValue(undefined),
      openFontPresetFolder: vi.fn().mockResolvedValue(undefined),
      reloadLocalization: vi.fn().mockResolvedValue({
        snapshot: {},
        loadedUserPacks: 1,
        rejectedUserPacks: 0
      })
    } as unknown as LumoraApi;

    renderWithLocalization(<ModsSettingsPanel active api={api} />);

    expect(await screen.findByText(managed.rootPath)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder' }));
    expect(await screen.findByText(custom.rootPath)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Open Mods folder' }));
    await waitFor(() => expect(api.openModsRoot).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Open locales folder' }));
    await waitFor(() => expect(api.openUserLocaleFolder).toHaveBeenCalledOnce());
    expect(screen.getByText(custom.fontsPath)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Open font presets folder' }));
    await waitFor(() => expect(api.openFontPresetFolder).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Reload languages' }));
    await waitFor(() => expect(api.reloadLocalization).toHaveBeenCalledOnce());
    expect(screen.getByRole('status')).toHaveTextContent('Language packs reloaded.');
    fireEvent.click(screen.getByRole('button', { name: 'Use default' }));
    expect(await screen.findByText(managed.rootPath)).toBeVisible();

    expect(api.chooseModsRoot).toHaveBeenCalledOnce();
    expect(api.openModsRoot).toHaveBeenCalledOnce();
    expect(api.openUserLocaleFolder).toHaveBeenCalledOnce();
    expect(api.openFontPresetFolder).toHaveBeenCalledOnce();
    expect(api.resetModsRoot).toHaveBeenCalledOnce();
  });

  it('does not load until the Mods tab is active', () => {
    const api = { getModsSettings: vi.fn() } as unknown as LumoraApi;
    renderWithLocalization(<ModsSettingsPanel active={false} api={api} />);
    expect(api.getModsSettings).not.toHaveBeenCalled();
  });
});
