export const WINDOWS_APP_ID = 'app.lumora.desktop';

interface PackagedPlatformEnvironment {
  platform: NodeJS.Platform;
  packaged: boolean;
}

interface WindowsApplicationIdentity {
  setAppUserModelId(appId: string): void;
}

interface WindowsTaskbarWindow {
  setAppDetails(details: {
    appId: string;
    appIconPath: string;
    appIconIndex: number;
  }): void;
}

interface WindowsTaskbarEnvironment extends PackagedPlatformEnvironment {
  iconPath?: string;
}

export function configurePackagedWindowsApplicationIdentity(
  application: WindowsApplicationIdentity,
  environment: PackagedPlatformEnvironment
): void {
  if (environment.platform !== 'win32' || !environment.packaged) {
    return;
  }

  application.setAppUserModelId(WINDOWS_APP_ID);
}

export function configurePackagedWindowsTaskbarWindow(
  window: WindowsTaskbarWindow,
  environment: WindowsTaskbarEnvironment
): void {
  if (
    environment.platform !== 'win32' ||
    !environment.packaged ||
    environment.iconPath === undefined
  ) {
    return;
  }

  window.setAppDetails({
    appId: WINDOWS_APP_ID,
    appIconPath: environment.iconPath,
    appIconIndex: 0
  });
}
