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
      themesPath: 'C:\\Users\\Lumora\\mods\\themes',
      usesDefault: true
    };
    const custom = {
      rootPath: 'D:\\My Mods',
      localesPath: 'D:\\My Mods\\locales',
      fontsPath: 'D:\\My Mods\\fonts',
      themesPath: 'D:\\My Mods\\themes',
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
      openThemePresetFolder: vi.fn().mockResolvedValue(undefined),
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
    expect(screen.getByText(custom.themesPath)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Open theme packs folder' }));
    await waitFor(() => expect(api.openThemePresetFolder).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Reload languages' }));
    await waitFor(() => expect(api.reloadLocalization).toHaveBeenCalledOnce());
    expect(screen.getByRole('status')).toHaveTextContent('Language packs reloaded.');
    fireEvent.click(screen.getByRole('button', { name: 'Use default' }));
    expect(await screen.findByText(managed.rootPath)).toBeVisible();

    expect(api.chooseModsRoot).toHaveBeenCalledOnce();
    expect(api.openModsRoot).toHaveBeenCalledOnce();
    expect(api.openUserLocaleFolder).toHaveBeenCalledOnce();
    expect(api.openFontPresetFolder).toHaveBeenCalledOnce();
    expect(api.openThemePresetFolder).toHaveBeenCalledOnce();
    expect(api.resetModsRoot).toHaveBeenCalledOnce();
  });

  it('does not load until the Mods tab is active', () => {
    const api = { getModsSettings: vi.fn() } as unknown as LumoraApi;
    renderWithLocalization(<ModsSettingsPanel active={false} api={api} />);
    expect(api.getModsSettings).not.toHaveBeenCalled();
  });

  it('shows the loading mark on a reload, and only on a reload', async () => {
    let finishOpen!: () => void;
    let finishReload!: (result: unknown) => void;
    const managed = {
      rootPath: 'mods-root',
      localesPath: 'mods-root/locales',
      fontsPath: 'mods-root/fonts',
      themesPath: 'mods-root/themes',
      usesDefault: true
    };
    const api = {
      getModsSettings: vi.fn().mockResolvedValue(managed),
      chooseModsRoot: vi.fn(),
      resetModsRoot: vi.fn(),
      openModsRoot: vi.fn(),
      openUserLocaleFolder: vi.fn(() => new Promise<void>((resolve) => {
        finishOpen = resolve;
      })),
      openFontPresetFolder: vi.fn(),
      openThemePresetFolder: vi.fn(),
      reloadLocalization: vi.fn(() => new Promise((resolve) => {
        finishReload = resolve;
      }))
    } as unknown as LumoraApi;

    renderWithLocalization(<ModsSettingsPanel active api={api} />);
    const reload = await screen.findByRole('button', { name: 'Reload languages' });

    // Opening a folder occupies the panel, but it is not a reload, so the
    // reload button waits without claiming the work as its own.
    fireEvent.click(screen.getByRole('button', { name: 'Open locales folder' }));
    await waitFor(() => expect(api.openUserLocaleFolder).toHaveBeenCalledOnce());
    expect(reload).toBeDisabled();
    expect(reload).toHaveAttribute('aria-busy', 'false');
    expect(reload.querySelector('.icon-loading')).toBeNull();
    finishOpen();
    await waitFor(() => expect(reload).not.toBeDisabled());

    fireEvent.click(reload);
    await waitFor(() => expect(reload).toHaveAttribute('aria-busy', 'true'));
    expect(reload.querySelector('.icon-loading')).not.toBeNull();
    finishReload({ snapshot: {}, loadedUserPacks: 1, rejectedUserPacks: 0 });
    await waitFor(() => expect(reload).toHaveAttribute('aria-busy', 'false'));
    expect(reload.querySelector('.icon-loading')).toBeNull();
  });
});
