import { describe, expect, it, vi } from 'vitest';

import {
  configurePackagedWindowsApplicationIdentity,
  configurePackagedWindowsTaskbarWindow,
  WINDOWS_APP_ID
} from './windows-taskbar';

describe('packaged Windows taskbar identity', () => {
  it('matches the Windows application ID used by electron-builder', () => {
    expect(WINDOWS_APP_ID).toBe('app.lumora.desktop');
  });

  it('sets the process identity only for packaged Windows', () => {
    const setAppUserModelId = vi.fn();
    const application = { setAppUserModelId };

    configurePackagedWindowsApplicationIdentity(application, {
      platform: 'win32',
      packaged: true
    });
    configurePackagedWindowsApplicationIdentity(application, {
      platform: 'win32',
      packaged: false
    });
    configurePackagedWindowsApplicationIdentity(application, {
      platform: 'darwin',
      packaged: true
    });

    expect(setAppUserModelId).toHaveBeenCalledOnce();
    expect(setAppUserModelId).toHaveBeenCalledWith(WINDOWS_APP_ID);
  });

  it('sets the transparent relaunch icon only for packaged Windows windows', () => {
    const setAppDetails = vi.fn();
    const window = { setAppDetails };
    const iconPath = 'C:\\Program Files\\Lumora\\resources\\icons\\LumoraTransparent.ico';

    configurePackagedWindowsTaskbarWindow(window, {
      platform: 'win32',
      packaged: true,
      iconPath
    });
    configurePackagedWindowsTaskbarWindow(window, {
      platform: 'win32',
      packaged: false,
      iconPath
    });
    configurePackagedWindowsTaskbarWindow(window, {
      platform: 'linux',
      packaged: true,
      iconPath
    });
    configurePackagedWindowsTaskbarWindow(window, {
      platform: 'win32',
      packaged: true
    });

    expect(setAppDetails).toHaveBeenCalledOnce();
    expect(setAppDetails).toHaveBeenCalledWith({
      appId: WINDOWS_APP_ID,
      appIconPath: iconPath,
      appIconIndex: 0
    });
  });
});
