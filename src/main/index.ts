import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  screen,
  shell
} from 'electron';

import { IPC_CHANNELS, PlatformSchema } from '../shared/contracts';
import { configureApplicationMenu } from './application-menu';
import {
  createCatalogRuntime,
  type CatalogRuntime
} from './catalog/catalog-runtime';
import { configureDevelopmentDataPaths } from './development-data-paths';
import { createDeveloperEnvironmentScanner } from './environment/developer-environment';
import { registerCatalogIpc } from './ipc/register-catalog-ipc';
import { registerClipboardIpc } from './ipc/register-clipboard-ipc';
import { registerEnvironmentIpc } from './ipc/register-environment-ipc';
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
import { createSingleWindowCreationGate } from './single-window-creation';
import {
  configurePackagedWindowsApplicationIdentity,
  configurePackagedWindowsTaskbarWindow
} from './windows-taskbar';
import {
  createWindowStateManager,
  loadWindowRestore,
  type WindowStateManager
} from './window-state';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const developmentOrigin = process.env.ELECTRON_RENDERER_URL;
const platform = PlatformSchema.parse(process.platform);
const { preloadPath, rendererRoot, windowIconPath } = getRuntimePaths(
  currentDirectory,
  {
    platform,
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath
  }
);
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
const developerEnvironmentScanner = createDeveloperEnvironmentScanner(
  providerDependencies
);

let mainWindow: BrowserWindow | null = null;
let catalogRuntime: CatalogRuntime | null = null;
let terminalRuntime: TerminalRuntime | null = null;
let unsubscribeTerminalEvents: (() => void) | null = null;
let activeWindowStateManager: WindowStateManager | null = null;
let pendingWindowStateFlush: Promise<void> = Promise.resolve();
let shutdownStarted = false;

configureDevelopmentDataPaths(app);
configurePackagedWindowsApplicationIdentity(app, {
  platform,
  packaged: app.isPackaged
});
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

async function prepareMainWindow() {
  await pendingWindowStateFlush;
  const statePath = join(app.getPath('userData'), 'window-state.json');
  const restore = await loadWindowRestore({
    statePath,
    workAreas: screen.getAllDisplays().map((display) => display.workArea)
  });
  return { statePath, restore };
}

async function createMainWindow({
  statePath,
  restore
}: Awaited<ReturnType<typeof prepareMainWindow>>): Promise<void> {
  const secureWindowOptions = createSecureWindowOptions(
    preloadPath,
    windowIconPath
  );
  const window = new BrowserWindow({
    ...secureWindowOptions,
    ...(restore.normalBounds === null ? {} : restore.normalBounds)
  });
  configurePackagedWindowsTaskbarWindow(window, {
    platform,
    packaged: app.isPackaged,
    ...(windowIconPath === undefined ? {} : { iconPath: windowIconPath })
  });
  mainWindow = window;

  installWindowGuards(window.webContents, developmentOrigin);
  const windowStateManager = createWindowStateManager({
    window,
    statePath,
    initialNormalBounds: restore.normalBounds ?? window.getBounds()
  });
  activeWindowStateManager = windowStateManager;
  if (restore.maximized) {
    window.maximize();
  }
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    if (activeWindowStateManager === windowStateManager) {
      activeWindowStateManager = null;
    }
    void queueWindowStateFlush(windowStateManager.dispose());
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

function queueWindowStateFlush(flush: Promise<void>): Promise<void> {
  pendingWindowStateFlush = Promise.all([
    pendingWindowStateFlush,
    flush
  ]).then(() => undefined);
  return pendingWindowStateFlush;
}

function flushWindowState(): Promise<void> {
  const flush = activeWindowStateManager?.dispose() ?? Promise.resolve();
  activeWindowStateManager = null;
  return queueWindowStateFlush(flush);
}

const mainWindowCreation = createSingleWindowCreationGate({
  canCreate: () => !shutdownStarted && mainWindow === null,
  prepare: prepareMainWindow,
  create: createMainWindow
});

void app.whenReady().then(async () => {
  configureApplicationMenu(Menu, { platform });
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
  registerEnvironmentIpc({
    ipc: ipcMain,
    scanner: developerEnvironmentScanner,
    openExternal: (url) => shell.openExternal(url),
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
  registerClipboardIpc({
    ipc: ipcMain,
    clipboard: {
      readText: () => clipboard.readText(),
      writeText: (text) => clipboard.writeText(text)
    },
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

  await mainWindowCreation.ensureCreated();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void mainWindowCreation.ensureCreated();
    }
  });
});

app.on('before-quit', (event) => {
  if (shutdownStarted) {
    return;
  }
  event.preventDefault();
  shutdownStarted = true;
  const runtime = terminalRuntime;
  void (async () => {
    try {
      await Promise.all([
        runtime?.shutdown() ?? Promise.resolve(),
        flushWindowState()
      ]);
    } catch (error) {
      console.error('Unable to complete Lumora shutdown cleanly.', error);
    } finally {
      unsubscribeTerminalEvents?.();
      unsubscribeTerminalEvents = null;
      runtime?.close();
      if (terminalRuntime === runtime) {
        terminalRuntime = null;
      }
      catalogRuntime?.close();
      catalogRuntime = null;
      app.quit();
    }
  })();
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
