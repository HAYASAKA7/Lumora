import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { configureApplicationMenu } from './application-menu';

function createController() {
  const builtMenu = { kind: 'menu' };
  const buildFromTemplate = vi
    .fn<(template: MenuItemConstructorOptions[]) => typeof builtMenu>()
    .mockReturnValue(builtMenu);
  const setApplicationMenu = vi.fn<(menu: typeof builtMenu | null) => void>();
  return { builtMenu, buildFromTemplate, setApplicationMenu };
}

describe('configureApplicationMenu', () => {
  it.each(['win32', 'linux'] as const)(
    'removes the application menu on %s',
    (platform) => {
      const controller = createController();

      configureApplicationMenu(controller, { platform });

      expect(controller.buildFromTemplate).not.toHaveBeenCalled();
      expect(controller.setApplicationMenu).toHaveBeenCalledOnce();
      expect(controller.setApplicationMenu).toHaveBeenCalledWith(null);
    }
  );

  it('installs only native application, edit, and window menus on macOS', () => {
    const controller = createController();

    configureApplicationMenu(controller, { platform: 'darwin' });

    expect(controller.buildFromTemplate).toHaveBeenCalledOnce();
    expect(controller.buildFromTemplate).toHaveBeenCalledWith([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'windowMenu' }
    ]);
    expect(controller.setApplicationMenu).toHaveBeenCalledWith(
      controller.builtMenu
    );
  });

  it('configures the application menu before creating the first window', () => {
    const mainSource = readFileSync(
      fileURLToPath(new URL('./index.ts', import.meta.url)),
      'utf8'
    );
    const configurationIndex = mainSource.indexOf(
      'configureApplicationMenu(Menu, { platform });'
    );
    const firstWindowIndex = mainSource.indexOf('await createMainWindow();');

    expect(configurationIndex).toBeGreaterThan(-1);
    expect(firstWindowIndex).toBeGreaterThan(configurationIndex);
  });
});
