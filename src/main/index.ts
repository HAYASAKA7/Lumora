import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol
} from 'electron';

import { IPC_CHANNELS, PlatformSchema } from '../shared/contracts';
import {
  createCatalogRuntime,
  type CatalogRuntime
} from './catalog/catalog-runtime';
import { registerCatalogIpc } from './ipc/register-catalog-ipc';
import { registerProviderIpc } from './ipc/register-provider-ipc';
import { registerSystemIpc } from './ipc/register-system-ipc';
import { registerTerminalIpc } from './ipc/register-terminal-ipc';
import { findExecutable } from './platform/executable-locator';
import { probeVersion } from './platform/version-probe';
import { createClaudeAdapter } from './providers/claude-adapter';
import { createCodexAdapter } from './providers/codex-adapter';
import { ProviderRegistry } from './providers/provider-registry';
import { getRuntimePaths } from './runtime-paths';
import {
  createTerminalRuntime,
  type TerminalRuntime
} from './terminal/terminal-runtime';
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
let catalogRuntime: CatalogRuntime | null = null;
let terminalRuntime: TerminalRuntime | null = null;
let unsubscribeTerminalEvents: (() => void) | null = null;
let shutdownStarted = false;

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
  catalogRuntime = createCatalogRuntime({
    databasePath: join(app.getPath('userData'), 'lumora.db'),
    homeDirectory: app.getPath('home'),
    platform,
    env: process.env,
    scanProviders: () => providerRegistry.scan()
  });
  terminalRuntime = await createTerminalRuntime({
    databasePath: join(app.getPath('userData'), 'lumora.db'),
    platform,
    env: process.env,
    scanProviders: () => providerRegistry.scan(),
    refreshCatalog: () => catalogRuntime!.service.refreshCatalog()
  });
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
  registerCatalogIpc({
    ipc: ipcMain,
    service: catalogRuntime.service,
    showOpenDialog: (options) => dialog.showOpenDialog(options),
    ...(developmentOrigin === undefined ? {} : { developmentOrigin })
  });
  unsubscribeTerminalEvents = registerTerminalIpc({
    ipc: ipcMain,
    runtime: terminalRuntime,
    sendRuntimeEvent: (event) => {
      if (mainWindow !== null && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.runtimeEvent, event);
      }
    },
    ...(developmentOrigin === undefined ? {} : { developmentOrigin })
  });

  await createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

app.on('before-quit', (event) => {
  if (terminalRuntime === null || shutdownStarted) {
    return;
  }
  event.preventDefault();
  shutdownStarted = true;
  const runtime = terminalRuntime;
  void runtime.shutdown().finally(() => {
    unsubscribeTerminalEvents?.();
    unsubscribeTerminalEvents = null;
    runtime.close();
    terminalRuntime = null;
    catalogRuntime?.close();
    catalogRuntime = null;
    app.quit();
  });
});

app.on('will-quit', () => {
  unsubscribeTerminalEvents?.();
  unsubscribeTerminalEvents = null;
  terminalRuntime?.close();
  terminalRuntime = null;
  catalogRuntime?.close();
  catalogRuntime = null;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
