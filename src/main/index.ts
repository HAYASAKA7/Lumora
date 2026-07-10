import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  ipcMain,
  net,
  protocol
} from 'electron';

import { registerSystemIpc } from './ipc/register-system-ipc';
import {
  createSecureWindowOptions,
  installWindowGuards,
  resolveRendererAssetPath
} from './security-policy';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const preloadPath = join(currentDirectory, '../preload/index.js');
const rendererRoot = join(currentDirectory, '../renderer');
const developmentOrigin = process.env.ELECTRON_RENDERER_URL;

let mainWindow: BrowserWindow | null = null;

app.enableSandbox();
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
      stream: true,
      codeCache: true
    }
  }
]);

function registerApplicationProtocol(): void {
  protocol.handle('app', async (request) => {
    const assetPath = resolveRendererAssetPath(rendererRoot, request.url);
    if (assetPath === null) {
      return new Response('Not found', { status: 404 });
    }

    return net.fetch(pathToFileURL(assetPath).toString());
  });
}

async function createMainWindow(): Promise<void> {
  const window = new BrowserWindow(createSecureWindowOptions(preloadPath));
  mainWindow = window;

  installWindowGuards(window.webContents, developmentOrigin);
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  if (developmentOrigin !== undefined) {
    await window.loadURL(developmentOrigin);
    return;
  }

  await window.loadURL('app://lumora/index.html');
}

void app.whenReady().then(async () => {
  registerApplicationProtocol();
  registerSystemIpc({
    ipc: ipcMain,
    platform: process.platform,
    arch: process.arch,
    appVersion: app.getVersion(),
    ...(developmentOrigin === undefined ? {} : { developmentOrigin })
  });

  await createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
