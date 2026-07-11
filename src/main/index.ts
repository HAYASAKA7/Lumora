import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  ipcMain,
  net,
  protocol
} from 'electron';

import { PlatformSchema } from '../shared/contracts';
import { registerProviderIpc } from './ipc/register-provider-ipc';
import { registerSystemIpc } from './ipc/register-system-ipc';
import { findExecutable } from './platform/executable-locator';
import { probeVersion } from './platform/version-probe';
import { createClaudeAdapter } from './providers/claude-adapter';
import { createCodexAdapter } from './providers/codex-adapter';
import { ProviderRegistry } from './providers/provider-registry';
import { getRuntimePaths } from './runtime-paths';
import {
  createSecureWindowOptions,
  installWindowGuards,
  resolveRendererAssetPath
} from './security-policy';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const { preloadPath, rendererRoot } = getRuntimePaths(currentDirectory);
const developmentOrigin = process.env.ELECTRON_RENDERER_URL;
const platform = PlatformSchema.parse(process.platform);
const providerDependencies = {
  findExecutable: (command: string) =>
    findExecutable(command, { platform, env: process.env }),
  probeVersion: (executablePath: string) =>
    probeVersion(executablePath, { platform, env: process.env })
};
const providerRegistry = new ProviderRegistry({
  codex: createCodexAdapter(providerDependencies),
  claude: createClaudeAdapter(providerDependencies)
});

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
  registerProviderIpc({
    ipc: ipcMain,
    registry: providerRegistry,
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
