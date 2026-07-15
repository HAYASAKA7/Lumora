import type { MenuItemConstructorOptions } from 'electron';

interface ApplicationMenuController<MenuType> {
  buildFromTemplate(template: MenuItemConstructorOptions[]): MenuType;
  setApplicationMenu(menu: MenuType | null): void;
}

interface ApplicationMenuEnvironment {
  platform: NodeJS.Platform;
}

export function configureApplicationMenu<MenuType>(
  controller: ApplicationMenuController<MenuType>,
  environment: ApplicationMenuEnvironment
): void {
  if (environment.platform !== 'darwin') {
    controller.setApplicationMenu(null);
    return;
  }

  const menu = controller.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { role: 'windowMenu' }
  ]);
  controller.setApplicationMenu(menu);
}
