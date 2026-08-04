import { randomUUID } from 'node:crypto';
import { stat, statfs } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  protocol,
  screen,
  shell,
  Tray
} from 'electron';
import type { MenuItemConstructorOptions } from 'electron';

import {
  IPC_CHANNELS,
  LOCAL_EXECUTION_TARGET_ID,
  PlatformSchema,
  TrayResumeSessionRequestSchema
} from '../shared/contracts';
import { configureApplicationMenu } from './application-menu';
import { AppearanceBackgroundStore } from './appearance/appearance-background-store';
import {
  createCatalogRuntime,
  type CatalogRuntime
} from './catalog/catalog-runtime';
import { configureDevelopmentDataPaths } from './development-data-paths';
import { createDeveloperEnvironmentScanner } from './environment/developer-environment';
import { createLocalIpcAuthorizer } from './ipc/ipc-access';
import { registerCatalogIpc } from './ipc/register-catalog-ipc';
import { registerAppearanceIpc } from './ipc/register-appearance-ipc';
import { registerClipboardIpc } from './ipc/register-clipboard-ipc';
import { registerEnvironmentIpc } from './ipc/register-environment-ipc';
import { registerProviderIpc } from './ipc/register-provider-ipc';
import { registerSystemIpc } from './ipc/register-system-ipc';
import { registerTerminalIpc } from './ipc/register-terminal-ipc';
import { registerTransferIpc } from './ipc/register-transfer-ipc';
import { findExecutable } from './platform/executable-locator';
import { canonicalizeWorkspacePath } from './platform/workspace-path';
import { resolveApplicationEnvironment } from './platform/login-shell-path';
import { probeVersion } from './platform/version-probe';
import { createProviderAdapters } from './providers/provider-adapter';
import { createProviderReleaseSource } from './providers/provider-release-source';
import { runProviderLifecycle } from './providers/provider-lifecycle-runner';
import { ProviderRegistry } from './providers/provider-registry';
import { createProviderPolicy } from './providers/provider-policy';
import { ProviderScanCoordinator } from './providers/provider-scan-coordinator';
import { createProviderUpdateService } from './providers/provider-update-service';
import { getRuntimePaths } from './runtime-paths';
import {
  createTrayController,
  type TrayController
} from './tray-controller';
import {
  createTerminalRuntime,
  type TerminalRuntime
} from './terminal/terminal-runtime';
import {
  createSessionTransferRuntime,
  type SessionTransferRuntime
} from './transfer/session-transfer-runtime';
import {
  createSecureWindowOptions,
  installWindowGuards,
  resolveAppearanceBackgroundRequest,
  resolveRendererAssetPath
} from './security-policy';
import { createSingleWindowCreationGate } from './single-window-creation';
import {
  createStartupBackgroundActivityController,
  createStartupPresentationController,
  type StartupBackgroundActivityController
} from './startup-presentation';
import {
  configurePackagedWindowsApplicationIdentity,
  configurePackagedWindowsTaskbarWindow
} from './windows-taskbar';
import {
  applyStartupMaximization,
  createWindowStateManager,
  loadWindowRestore,
  type WindowStateManager
} from './window-state';
import { resolveWindowCloseAction } from './window-close-policy';
import { createWindowContextRegistry } from './targets/window-context-registry';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const developmentOrigin = process.env.ELECTRON_RENDERER_URL;
const windowContexts = createWindowContextRegistry();
const authorizeLocalIpc = createLocalIpcAuthorizer({
  contexts: windowContexts,
  ...(developmentOrigin === undefined ? {} : { developmentOrigin })
});
const platform = PlatformSchema.parse(process.platform);
const { preloadPath, rendererRoot, windowIconPath, trayIconPath } = getRuntimePaths(
  currentDirectory,
  {
    platform,
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath
  }
);
let applicationEnvironment: Readonly<
  Record<string, string | undefined>
> = process.env;
const providerDependencies = {
  findExecutable: (command: string) =>
    findExecutable(command, { platform, env: applicationEnvironment }),
  probeVersion: (executablePath: string, args: readonly string[]) =>
    probeVersion(executablePath, {
      platform,
      env: applicationEnvironment,
      args
    })
};
const providerRegistry = new ProviderRegistry(
  createProviderAdapters(providerDependencies)
);
const providerScanCoordinator = new ProviderScanCoordinator((providers) =>
  providerRegistry.scan(providers)
);
const providerPolicy = createProviderPolicy();
const scanEnabledProviders = () =>
  providerScanCoordinator.scan(providerPolicy.providers());
const providerReleaseSource = createProviderReleaseSource({
  fetch: (input, init) => net.fetch(input, init)
});
const providerUpdateService = createProviderUpdateService({
  registry: {
    scan: scanEnabledProviders,
    scanFresh: () =>
      providerScanCoordinator.scanFresh(providerPolicy.providers())
  },
  enabledProviders: () => providerPolicy.providers(),
  releases: providerReleaseSource,
  runLifecycle: (provider) =>
    runProviderLifecycle(provider, {
      platform,
      env: applicationEnvironment,
      findExecutable: providerDependencies.findExecutable
    })
});
const developerEnvironmentScanner = createDeveloperEnvironmentScanner(
  {
    findExecutable: providerDependencies.findExecutable,
    probeVersion: (executablePath) =>
      providerDependencies.probeVersion(executablePath, ['--version'])
  }
);
const startupPresentation = createStartupPresentationController();

let mainWindow: BrowserWindow | null = null;
let catalogRuntime: CatalogRuntime | null = null;
let terminalRuntime: TerminalRuntime | null = null;
let transferRuntime: SessionTransferRuntime | null = null;
let unsubscribeTerminalEvents: (() => void) | null = null;
let activeWindowStateManager: WindowStateManager | null = null;
let activeStartupBackgroundActivity:
  | StartupBackgroundActivityController
  | null = null;
let pendingWindowStateFlush: Promise<void> = Promise.resolve();
let activeStartupBackgroundActivityId: number | null = null;
let trayController: TrayController | null = null;
let appearanceBackgroundStore: AppearanceBackgroundStore | null = null;
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
    const backgroundPath = appearanceBackgroundStore === null
      ? null
      : resolveAppearanceBackgroundRequest(
          appearanceBackgroundStore.path,
          request.url
        );
    if (backgroundPath !== null) {
      try {
        return await net.fetch(pathToFileURL(backgroundPath).toString());
      } catch {
        return new Response('Not found', { status: 404 });
      }
    }

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
  const restoredWindowState = await loadWindowRestore({
    statePath,
    workAreas: screen.getAllDisplays().map((display) => display.workArea)
  });
  const restore = applyStartupMaximization(
    restoredWindowState,
    terminalRuntime?.getGeneralSettings().startMaximized ?? true
  );
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
  windowContexts.register(window.webContents.id, {
    mode: 'local',
    executionTargetId: LOCAL_EXECUTION_TARGET_ID
  });
  const startupBackgroundActivityId = window.webContents.id;
  const startupBackgroundActivity =
    createStartupBackgroundActivityController(window.webContents);
  if (startupPresentation.isClaimAvailable()) {
    startupBackgroundActivity.start();
  }
  activeStartupBackgroundActivity = startupBackgroundActivity;
  activeStartupBackgroundActivityId = startupBackgroundActivityId;
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
  window.once('ready-to-show', () => {
    window.show();
    startupPresentation.markWindowShown();
  });
  window.on('show', () => trayController?.refresh());
  window.on('hide', () => trayController?.refresh());
  window.on('close', (event) => {
    const closeAction = resolveWindowCloseAction({
      shutdownStarted,
      behavior:
        terminalRuntime?.getGeneralSettings().windowCloseBehavior ?? 'quit'
    });
    if (closeAction === 'allow') return;

    event.preventDefault();
    if (closeAction === 'hide') {
      window.hide();
      return;
    }
    app.quit();
  });
  window.on('closed', () => {
    windowContexts.unregister(window.webContents.id);
    startupBackgroundActivity.dispose();
    if (activeStartupBackgroundActivity === startupBackgroundActivity) {
      activeStartupBackgroundActivityId = null;
      activeStartupBackgroundActivity = null;
    }
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

function createApplicationTray(): void {
  if (trayController !== null || trayIconPath === undefined) return;
  const trayImage = nativeImage.createFromPath(trayIconPath);
  if (trayImage.isEmpty()) {
    console.error('Lumora could not load its tray icon.', trayIconPath);
    return;
  }
  trayImage.setTemplateImage(platform === 'darwin');
  const tray = new Tray(trayImage);
  trayController = createTrayController({
    tray,
    buildMenu: (template) => Menu.buildFromTemplate(
      template as MenuItemConstructorOptions[]
    ),
    getState: () => ({
      windowVisible: mainWindow?.isVisible() ?? false,
      runtimes: terminalRuntime?.listRuntimes() ?? [],
      sessions: catalogRuntime?.service.getCatalog().sessions ?? []
    }),
    onShowWindow: () => {
      void showOrCreateMainWindow();
    },
    onToggleWindow: () => {
      if (mainWindow !== null && mainWindow.isVisible()) {
        mainWindow.hide();
        return;
      }
      void showOrCreateMainWindow();
    },
    onResumeSession: (sessionId) => {
      const request = TrayResumeSessionRequestSchema.parse({ sessionId });
      void showOrCreateMainWindow().then(() => {
        if (mainWindow !== null && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send(
            IPC_CHANNELS.trayResumeSession,
            request
          );
        }
      });
    },
    onExit: () => app.quit()
  });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    void showOrCreateMainWindow();
  });
}

if (hasSingleInstanceLock) void app.whenReady().then(async () => {
  applicationEnvironment = await resolveApplicationEnvironment({
    platform,
    env: process.env
  });
  configureApplicationMenu(Menu, { platform });
  appearanceBackgroundStore = new AppearanceBackgroundStore({
    directory: join(app.getPath('userData'), 'appearance'),
    loadImage: (path) => nativeImage.createFromPath(path)
  });
  registerApplicationProtocol();
  catalogRuntime = createCatalogRuntime({
    databasePath: join(app.getPath('userData'), 'lumora.db'),
    homeDirectory: app.getPath('home'),
    platform,
    env: applicationEnvironment,
    scanProviders: scanEnabledProviders,
    enabledProviders: () => providerPolicy.providers(),
    allowExperimentalTransferRoutes: !app.isPackaged
  });
  terminalRuntime = await createTerminalRuntime({
    databasePath: join(app.getPath('userData'), 'lumora.db'),
    handoffRootDirectory: join(app.getPath('userData'), 'handoffs'),
    platform,
    env: applicationEnvironment,
    scanProviders: scanEnabledProviders,
    sessionCatalogRegistry: catalogRuntime.registry,
    refreshCatalog: () => catalogRuntime!.service.refreshCatalog(),
    onGeneralSettingsSaved: (settings) =>
      providerPolicy.replace(settings.enabledProviders)
  });
  providerPolicy.replace(terminalRuntime.getGeneralSettings().enabledProviders);
  transferRuntime = await createSessionTransferRuntime({
    databasePath: join(app.getPath('userData'), 'lumora.db'),
    appUserDataPath: app.getPath('userData'),
    serviceDependencies: {
      platform,
      adapters: catalogRuntime.transferRegistry,
      catalog: catalogRuntime.transferCatalog,
      activeSessions: () => terminalRuntime!.activeTransferSessions(),
      scanProviders: scanEnabledProviders,
      workspaceById: (workspaceId) => {
        const workspace = catalogRuntime!.service
          .getCatalog()
          .workspaces.find((candidate) => candidate.id === workspaceId);
        return workspace?.available === true
          ? {
              id: workspace.id,
              canonicalPath: workspace.canonicalPath,
              displayName: workspace.displayName
            }
          : null;
      },
      workspaceCandidates: async () =>
        catalogRuntime!.service
          .getCatalog()
          .workspaces.filter((workspace) => workspace.available)
          .map((workspace) => ({
            workspaceId: workspace.id,
            canonicalPath: workspace.canonicalPath,
            displayName: workspace.displayName,
            gitRemote: null,
            markers: []
          })),
      workspaceProbes: {
        isDirectory: async (path) => {
          try {
            return (await stat(path)).isDirectory();
          } catch {
            return false;
          }
        }
      },
      refreshCatalog: async () => {
        await catalogRuntime!.service.refreshCatalog();
        terminalRuntime!.synchronizeCatalogSessions();
        trayController?.refresh();
      },
      freeDiskBytes: async (path) => {
        const filesystem = await statfs(path);
        return filesystem.bavail * filesystem.bsize;
      },
      clock: () => new Date(),
      createToken: () => randomUUID(),
      onProgress: (event) => {
        if (mainWindow !== null && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send(IPC_CHANNELS.transferEvent, event);
        }
      }
    }
  });
  const transferService = transferRuntime.service;
  if (transferService === null) {
    throw new Error('The session transfer service was not composed.');
  }
  registerSystemIpc({
    ipc: ipcMain,
    authorize: authorizeLocalIpc,
    platform: process.platform,
    arch: process.arch,
    appVersion: app.getVersion(),
    claimStartupPresentation: async (senderId) => {
      const startupBackgroundActivity =
        activeStartupBackgroundActivityId === senderId
          ? activeStartupBackgroundActivity
          : null;
      const shouldPlay = await startupPresentation.claim();
      if (shouldPlay) {
        startupBackgroundActivity?.start();
      }
      return shouldPlay;
    },
    completeStartupPresentation: (senderId) => {
      if (activeStartupBackgroundActivityId === senderId) {
        activeStartupBackgroundActivity?.complete();
      }
    },
    ...(developmentOrigin === undefined ? {} : { developmentOrigin })
  });
  registerEnvironmentIpc({
    ipc: ipcMain,
    authorize: authorizeLocalIpc,
    scanner: developerEnvironmentScanner,
    openExternal: (url) => shell.openExternal(url),
    ...(developmentOrigin === undefined ? {} : { developmentOrigin })
  });
  registerProviderIpc({
    ipc: ipcMain,
    authorize: authorizeLocalIpc,
    registry: { scan: scanEnabledProviders },
    updates: providerUpdateService,
    openExternal: (url) => shell.openExternal(url),
    ...(developmentOrigin === undefined ? {} : { developmentOrigin })
  });
  registerCatalogIpc({
    ipc: ipcMain,
    authorize: authorizeLocalIpc,
    service: catalogRuntime.service,
    showOpenDialog: (options) => dialog.showOpenDialog(options),
    onCatalogRefreshed: () => {
      terminalRuntime!.synchronizeCatalogSessions();
      trayController?.refresh();
    },
    ...(developmentOrigin === undefined ? {} : { developmentOrigin })
  });
  registerTransferIpc({
    ipc: ipcMain,
    authorize: authorizeLocalIpc,
    service: transferService,
    downloadsDirectory: app.getPath('downloads'),
    lastDirectory: (direction) =>
      transferRuntime!.repository.getLastDirectory(direction),
    showSaveDialog: (options) => dialog.showSaveDialog(options),
    showOpenDialog: (options) => dialog.showOpenDialog(options),
    registerWorkspace: async (path) => {
      const canonical = await canonicalizeWorkspacePath(path, { platform });
      const snapshot = await catalogRuntime!.service.registerWorkspace(path);
      const workspace = snapshot.workspaces.find(
        (candidate) => candidate.id === canonical.id
      );
      if (workspace === undefined || !workspace.available) {
        throw new Error('The selected workspace could not be registered.');
      }
      return workspace;
    },
    ...(developmentOrigin === undefined ? {} : { developmentOrigin })
  });
  registerClipboardIpc({
    ipc: ipcMain,
    authorize: authorizeLocalIpc,
    clipboard: {
      readText: () => clipboard.readText(),
      writeText: (text) => clipboard.writeText(text)
    },
    ...(developmentOrigin === undefined ? {} : { developmentOrigin })
  });
  registerAppearanceIpc({
    ipc: ipcMain,
    authorize: authorizeLocalIpc,
    service: appearanceBackgroundStore,
    showOpenDialog: (options) => dialog.showOpenDialog(options),
    ...(developmentOrigin === undefined ? {} : { developmentOrigin })
  });
  unsubscribeTerminalEvents = registerTerminalIpc({
    ipc: ipcMain,
    authorize: authorizeLocalIpc,
    runtime: terminalRuntime,
    openExternal: (url) => shell.openExternal(url),
    sendRuntimeEvent: (event) => {
      if (event.type === 'state') {
        trayController?.refresh();
      }
      if (mainWindow !== null && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.runtimeEvent, event);
      }
    },
    ...(developmentOrigin === undefined ? {} : { developmentOrigin })
  });

  await mainWindowCreation.ensureCreated();
  createApplicationTray();

  app.on('activate', () => {
    void showOrCreateMainWindow();
  });
});

async function showOrCreateMainWindow(): Promise<void> {
  await app.whenReady();
  if (shutdownStarted) return;
  await mainWindowCreation.ensureCreated();
  const window = mainWindow;
  if (window === null || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  trayController?.refresh();
}

app.on('before-quit', (event) => {
  if (shutdownStarted) {
    return;
  }
  event.preventDefault();
  shutdownStarted = true;
  const runtime = terminalRuntime;
  const transfer = transferRuntime;
  void (async () => {
    try {
      const shutdownErrors: unknown[] = [];
      try {
        await transfer?.close();
      } catch (error) {
        shutdownErrors.push(error);
      }
      if (transferRuntime === transfer) {
        transferRuntime = null;
      }
      try {
        await Promise.all([
          runtime?.shutdown() ?? Promise.resolve(),
          flushWindowState()
        ]);
      } catch (error) {
        shutdownErrors.push(error);
      }
      if (shutdownErrors.length > 0) {
        throw shutdownErrors[0];
      }
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
  trayController?.dispose();
  trayController = null;
  unsubscribeTerminalEvents?.();
  unsubscribeTerminalEvents = null;
  const transfer = transferRuntime;
  transferRuntime = null;
  const closeDatabaseOwners = () => {
    terminalRuntime?.close();
    terminalRuntime = null;
    catalogRuntime?.close();
    catalogRuntime = null;
  };
  if (transfer === null) {
    closeDatabaseOwners();
  } else {
    void transfer.close().finally(closeDatabaseOwners);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
