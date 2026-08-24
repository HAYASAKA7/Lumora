import { randomUUID } from 'node:crypto';
import { mkdir, stat, statfs, writeFile as writeTextFile } from 'node:fs/promises';
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
  safeStorage,
  screen,
  shell,
  Tray
} from 'electron';
import type { MenuItemConstructorOptions } from 'electron';

import {
  IPC_CHANNELS,
  LOCAL_EXECUTION_TARGET_ID,
  PlatformSchema,
  RemoteExecutionTargetIdSchema,
  TrayResumeSessionRequestSchema,
  type ApplicationQuitResolution,
  type ProviderId
} from '../shared/contracts';
import { configureApplicationMenu } from './application-menu';
import { createApplicationQuitGuard } from './application-quit-guard';
import { AppearanceBackgroundStore } from './appearance/appearance-background-store';
import {
  createCatalogRuntime,
  type CatalogRuntime
} from './catalog/catalog-runtime';
import { configureDevelopmentDataPaths } from './development-data-paths';
import { createDeveloperEnvironmentScanner } from './environment/developer-environment';
import { countActiveTerminalRuntimes } from './diagnostics/active-terminal-count';
import { DiagnosticJournal } from './diagnostics/diagnostic-journal';
import { resolveDiagnosticJournalStorage } from './diagnostics/diagnostic-journal-migration';
import { DiagnosticPreferencesStore } from './diagnostics/diagnostic-preferences-store';
import {
  createDiagnosticService,
  type DiagnosticService
} from './diagnostics/diagnostic-service';
import { installDiagnosticProcessObservers } from './diagnostics/diagnostic-process-observers';
import {
  createIpcAuthorizer,
  createLocalIpcAuthorizer
} from './ipc/ipc-access';
import { registerCatalogIpc } from './ipc/register-catalog-ipc';
import { registerAppearanceIpc } from './ipc/register-appearance-ipc';
import { registerAboutIpc } from './ipc/register-about-ipc';
import { registerClipboardIpc } from './ipc/register-clipboard-ipc';
import { registerDiagnosticIpc } from './ipc/register-diagnostic-ipc';
import { registerEnvironmentIpc } from './ipc/register-environment-ipc';
import { registerLocalizationIpc } from './ipc/register-localization-ipc';
import { registerProviderIpc } from './ipc/register-provider-ipc';
import { registerSystemIpc } from './ipc/register-system-ipc';
import { registerTargetIpc } from './ipc/register-target-ipc';
import { registerTerminalIpc } from './ipc/register-terminal-ipc';
import { registerTransferIpc } from './ipc/register-transfer-ipc';
import { createTerminalClipboardService } from './terminal/terminal-clipboard-service';
import { TerminalImageStager } from './terminal/terminal-image-stager';
import { registerWorkspaceVisibilityIpc } from './ipc/register-workspace-visibility-ipc';
import {
  LocalizationService,
  resolveLocalePaths
} from './localization';
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
import { createApplicationReleaseSource } from './release/application-release-source';
import {
  createApplicationReleaseRuntime,
  type ApplicationReleaseRuntime
} from './release/application-release-runtime';
import {
  createRemoteTargetRuntime,
  type RemoteTargetRuntime
} from './remote/remote-target-runtime';
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
  createSharedWindowStateManager,
  createWindowStateManager,
  loadWindowRestore,
  type SharedWindowStateManager,
  type WindowStateManager
} from './window-state';
import { resolveWindowCloseAction } from './window-close-policy';
import { createExecutionTargetGateway } from './targets/execution-target-gateway';
import { createTargetWindowManager } from './targets/target-window-manager';
import { createWindowContextRegistry } from './targets/window-context-registry';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const developmentOrigin = process.env.ELECTRON_RENDERER_URL;
interface ExecutionTargetServices {
  readonly catalog: CatalogRuntime['service'];
  readonly workspaceVisibility: CatalogRuntime['workspaceVisibility'];
  readonly terminal: TerminalRuntime;
  readonly environmentScanner: ReturnType<
    typeof createDeveloperEnvironmentScanner
  >;
  readonly providers: Readonly<{
    registry: Readonly<{ scan: typeof scanEnabledProviders }>;
    updates: ReturnType<typeof createProviderUpdateService>;
  }>;
  readonly transfer: Readonly<{
    service: NonNullable<SessionTransferRuntime['service']>;
    registerWorkspace(path: string): Promise<unknown>;
  }>;
}

const windowContexts = createWindowContextRegistry();
const executionTargetGateway =
  createExecutionTargetGateway<ExecutionTargetServices>();
const authorizeTargetIpc = createIpcAuthorizer({
  contexts: windowContexts,
  ...(developmentOrigin === undefined ? {} : { developmentOrigin })
});
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
const providerScanCoordinator = new ProviderScanCoordinator(
  (providers) => providerRegistry.scan(providers),
  {
    onSettled: (measurement) => {
      void diagnosticService?.record({
        severity: measurement.outcome === 'failed' ? 'warning' : 'info',
        subsystem: 'provider',
        operation: 'provider-scan',
        outcome: measurement.outcome,
        targetKind: 'local',
        durationMs: measurement.durationMs,
        counts: {
          cacheHits: measurement.cacheHits,
          queued: measurement.queued
        }
      }).catch(() => undefined);
    }
  }
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
  runLifecycle: (provider, action) =>
    runProviderLifecycle(provider, {
      action,
      platform,
      env: applicationEnvironment,
      findExecutable: providerDependencies.findExecutable,
      probeVersion: providerDependencies.probeVersion
    })
});
const developerEnvironmentScanner = createDeveloperEnvironmentScanner(
  {
    findExecutable: providerDependencies.findExecutable,
    probeVersion: (executablePath) =>
      providerDependencies.probeVersion(executablePath, ['--version'])
  },
  () => new Date(),
  {
    onSettled: (measurement) => {
      void diagnosticService?.record({
        severity: measurement.outcome === 'failed' ? 'warning' : 'info',
        subsystem: 'environment',
        operation: 'environment-scan',
        outcome: measurement.outcome,
        targetKind: 'local',
        durationMs: measurement.durationMs,
        counts: { cacheHits: measurement.cacheHits }
      }).catch(() => undefined);
    }
  }
);
const startupPresentation = createStartupPresentationController();

let mainWindow: BrowserWindow | null = null;
let catalogRuntime: CatalogRuntime | null = null;
let terminalRuntime: TerminalRuntime | null = null;
let localizationService: LocalizationService | null = null;
let transferRuntime: SessionTransferRuntime | null = null;
let remoteTargetRuntime: RemoteTargetRuntime | null = null;
let applicationReleaseRuntime: ApplicationReleaseRuntime | null = null;
let unsubscribeTerminalEvents: (() => void) | null = null;
let unsubscribeRemoteTerminalEvents: (() => void) | null = null;
let unsubscribeRemoteLifecycleEvents: (() => void) | null = null;
let unsubscribeLocalizationEvents: (() => void) | null = null;
let activeWindowStateManager: WindowStateManager | null = null;
let remoteWindowStateManager: SharedWindowStateManager | null = null;
let activeStartupBackgroundActivity:
  | StartupBackgroundActivityController
  | null = null;
let pendingWindowStateFlush: Promise<void> = Promise.resolve();
let activeStartupBackgroundActivityId: number | null = null;
let trayController: TrayController | null = null;
let appearanceBackgroundStore: AppearanceBackgroundStore | null = null;
let diagnosticJournal: DiagnosticJournal | null = null;
let diagnosticService: DiagnosticService | null = null;
let diagnosticPreferencesStore: DiagnosticPreferencesStore | null = null;
let disposeDiagnosticProcessObservers: (() => void) | null = null;
let shutdownStarted = false;
let applicationQuitApproved = false;
const pendingRemoteWindowCloses = new Set<string>();

const applicationQuitGuard = createApplicationQuitGuard({
  sendRequest: (request) => {
    const window = mainWindow;
    if (
      window === null ||
      window.isDestroyed() ||
      window.webContents.isDestroyed()
    ) return false;
    try {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      window.webContents.send(IPC_CHANNELS.applicationQuitRequest, request);
      return true;
    } catch {
      return false;
    }
  }
});

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
    windowContexts.unregister(startupBackgroundActivityId);
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

function flushRemoteWindowState(): Promise<void> {
  const manager = remoteWindowStateManager;
  remoteWindowStateManager = null;
  return manager?.dispose() ?? Promise.resolve();
}

const mainWindowCreation = createSingleWindowCreationGate({
  canCreate: () => !shutdownStarted && mainWindow === null,
  prepare: prepareMainWindow,
  create: createMainWindow
});

const targetWindowManager = createTargetWindowManager({
  contexts: windowContexts,
  createWindow: () => {
    if (remoteWindowStateManager === null) {
      throw new Error('Remote window state management is unavailable.');
    }
    const restore = remoteWindowStateManager.restore(
      screen.getAllDisplays().map((display) => display.workArea),
      terminalRuntime?.getGeneralSettings().startMaximized ?? true
    );
    const window = new BrowserWindow({
      ...createSecureWindowOptions(
        preloadPath,
        windowIconPath
      ),
      ...(restore.normalBounds === null ? {} : restore.normalBounds)
    });
    const trackedWindowState = remoteWindowStateManager.track(
      window,
      restore.normalBounds ?? window.getBounds()
    );
    if (restore.maximized) {
      window.maximize();
    }
    window.once('closed', () => {
      void trackedWindowState.dispose();
    });
    configurePackagedWindowsTaskbarWindow(window, {
      platform,
      packaged: app.isPackaged,
      ...(windowIconPath === undefined ? {} : { iconPath: windowIconPath })
    });
    installWindowGuards(window.webContents, developmentOrigin);
    return window;
  },
  loadWindow: (window) => window.loadURL(
    developmentOrigin ?? 'app://lumora/index.html'
  ),
  onCloseRequested: (executionTargetId, event) => {
    if (
      terminalRuntime?.getGeneralSettings().remoteWindowCloseBehavior !==
        'disconnect' ||
      remoteTargetRuntime === null
    ) return;

    event.preventDefault();
    if (pendingRemoteWindowCloses.has(executionTargetId)) return;
    const activeTerminalCount = remoteTargetRuntime.service
      .getLifecycleSnapshot(executionTargetId).activeTerminalCount;
    pendingRemoteWindowCloses.add(executionTargetId);
    if (
      activeTerminalCount > 0 &&
      terminalRuntime?.getGeneralSettings().warnBeforeRemoteDisconnect !== false
    ) {
      const delivered = targetWindowManager.send(
        executionTargetId,
        IPC_CHANNELS.remoteWindowCloseRequest,
        { executionTargetId, activeTerminalCount }
      );
      if (!delivered) {
        void disconnectAndCloseRemoteWindow(executionTargetId)
          .catch(() => undefined);
      }
      return;
    }

    void disconnectAndCloseRemoteWindow(executionTargetId)
      .catch(() => undefined);
  }
});

async function disconnectAndCloseRemoteWindow(
  executionTargetId: Parameters<typeof targetWindowManager.close>[0]
): Promise<boolean> {
  try {
    if (remoteTargetRuntime === null) return false;
    await remoteTargetRuntime.service.disconnect(executionTargetId);
    targetWindowManager.close(executionTargetId);
    return true;
  } finally {
    pendingRemoteWindowCloses.delete(executionTargetId);
  }
}

async function resolveRemoteWindowClose(
  executionTargetId: Parameters<typeof targetWindowManager.close>[0],
  resolution: {
    action: 'keep_running' | 'disconnect';
    suppressFutureWarning: boolean;
  }
): Promise<boolean> {
  if (!pendingRemoteWindowCloses.has(executionTargetId)) return false;
  if (resolution.action === 'disconnect') {
    const closed = await disconnectAndCloseRemoteWindow(executionTargetId);
    if (closed && resolution.suppressFutureWarning) {
      saveWarningPreference('warnBeforeRemoteDisconnect', false);
    }
    return closed;
  }
  pendingRemoteWindowCloses.delete(executionTargetId);
  targetWindowManager.close(executionTargetId);
  return true;
}

function broadcastGeneralSettingsChanged(): void {
  if (mainWindow !== null && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(IPC_CHANNELS.generalSettingsChanged, null);
  }
  targetWindowManager.broadcast(IPC_CHANNELS.generalSettingsChanged, null);
}

function saveWarningPreference(
  key: 'warnBeforeApplicationQuit' | 'warnBeforeRemoteDisconnect',
  value: boolean
): void {
  const runtime = terminalRuntime;
  if (runtime === null) return;
  try {
    runtime.saveGeneralSettings({
      ...runtime.getGeneralSettings(),
      [key]: value
    });
    broadcastGeneralSettingsChanged();
  } catch (error) {
    console.error('Lumora could not save an exit-warning preference.', error);
  }
}

async function resolveApplicationQuit(
  resolution: ApplicationQuitResolution
): Promise<boolean> {
  if (!applicationQuitGuard.resolve(resolution)) return false;
  if (resolution.action === 'cancel') return true;
  if (resolution.suppressFutureWarning) {
    saveWarningPreference('warnBeforeApplicationQuit', false);
  }
  applicationQuitApproved = true;
  app.quit();
  return true;
}

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
    getTranslator: () => {
      if (localizationService === null) {
        throw new Error('Localization is unavailable.');
      }
      return localizationService.getTranslator();
    },
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
  const userDataDirectory = app.getPath('userData');
  applicationReleaseRuntime = createApplicationReleaseRuntime({
    databasePath: join(userDataDirectory, 'lumora.db'),
    installedVersion: app.getVersion(),
    source: createApplicationReleaseSource({
      fetch: (input, init) => net.fetch(
        input instanceof URL ? input.href : input,
        init
      )
    }),
    openExternal: (url) => shell.openExternal(url)
  });
  void applicationReleaseRuntime.service.warm().catch(() => undefined);
  const defaultDiagnosticDirectory = join(userDataDirectory, 'diagnostics');
  diagnosticPreferencesStore = new DiagnosticPreferencesStore({
    preferencesPath: join(userDataDirectory, 'diagnostic-preferences.json'),
    defaultJournalDirectory: defaultDiagnosticDirectory,
    defaultExportDirectory: app.getPath('documents')
  });
  const diagnosticStorage = await resolveDiagnosticJournalStorage({
    store: diagnosticPreferencesStore,
    defaultDirectory: defaultDiagnosticDirectory
  });
  diagnosticJournal = new DiagnosticJournal({
    directory: diagnosticStorage.directory
  });
  const diagnosticRun = await diagnosticJournal.startRun();
  diagnosticService = createDiagnosticService({
    journal: diagnosticJournal,
    previousRunAbnormal: diagnosticRun.previousRunAbnormal,
    appVersion: app.getVersion(),
    platform,
    architecture: process.arch,
    getActiveAgentCount: () => countActiveTerminalRuntimes(
      terminalRuntime?.listRuntimes() ?? []
    ),
    getProcessMetrics: () => app.getAppMetrics(),
    getExportDirectory: async () => (
      await diagnosticPreferencesStore!.getSettings()
    ).effectiveExportDirectory,
    getFallbackExportDirectory: () => app.getPath('documents'),
    chooseExportPath: async (suggestedName, initialDirectory) => {
      const result = await dialog.showSaveDialog({
        title: 'Export Lumora diagnostics',
        defaultPath: join(initialDirectory, suggestedName),
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });
      return result.canceled || result.filePath === '' ? null : result.filePath;
    },
    rememberExportDirectory: async (directory) => {
      await diagnosticPreferencesStore!.selectExportDirectory(directory);
    },
    writeFile: (path, data) =>
      writeTextFile(path, data, { encoding: 'utf8', mode: 0o600 })
  });
  disposeDiagnosticProcessObservers = installDiagnosticProcessObservers({
    processHost: process,
    appHost: app,
    record: (input) => diagnosticService!.record(input)
  });
  await diagnosticService.record({
    severity: 'info',
    subsystem: 'startup',
    operation: 'application-start',
    outcome: 'started',
    targetKind: 'local'
  });
  applicationEnvironment = await resolveApplicationEnvironment({
    platform,
    env: process.env
  });
  if (shutdownStarted) return;
  configureApplicationMenu(Menu, { platform });
  appearanceBackgroundStore = new AppearanceBackgroundStore({
    directory: join(app.getPath('userData'), 'appearance'),
    loadImage: (path) => nativeImage.createFromPath(path)
  });
  registerApplicationProtocol();
  const credentialEncryption = {
    platform,
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    isAsyncEncryptionAvailable: () =>
      safeStorage.isAsyncEncryptionAvailable(),
    getSelectedStorageBackend: () => safeStorage.getSelectedStorageBackend(),
    encryptStringAsync: (value: string) =>
      safeStorage.encryptStringAsync(value),
    decryptStringAsync: (value: Buffer) =>
      safeStorage.decryptStringAsync(value)
  };
  remoteTargetRuntime = createRemoteTargetRuntime({
    databasePath: join(app.getPath('userData'), 'lumora.db'),
    credentialEncryption,
    providerReleases: providerReleaseSource,
    helperBundleRoot: app.isPackaged
      ? join(process.resourcesPath, 'helper')
      : join(app.getAppPath(), 'resources', 'helper', 'generated')
  });
  catalogRuntime = createCatalogRuntime({
    executionTargetId: LOCAL_EXECUTION_TARGET_ID,
    databasePath: join(app.getPath('userData'), 'lumora.db'),
    homeDirectory: app.getPath('home'),
    platform,
    env: applicationEnvironment,
    scanProviders: scanEnabledProviders,
    enabledProviders: () => providerPolicy.providers(),
    allowExperimentalTransferRoutes: true,
    onRefreshSettled: (measurement) => {
      void diagnosticService?.record({
        severity: measurement.outcome === 'failed' ? 'warning' : 'info',
        subsystem: 'catalog',
        operation: 'catalog-refresh',
        outcome: measurement.outcome,
        targetKind: 'local',
        durationMs: measurement.durationMs,
        counts: {
          ...measurement.counts,
          cacheHits: measurement.cacheHits
        }
      }).catch(() => undefined);
    }
  });
  terminalRuntime = await createTerminalRuntime({
    databasePath: join(app.getPath('userData'), 'lumora.db'),
    executionTargetId: LOCAL_EXECUTION_TARGET_ID,
    handoffRootDirectory: join(app.getPath('userData'), 'handoffs'),
    platform,
    env: applicationEnvironment,
    scanProviders: scanEnabledProviders,
    sessionCatalogRegistry: catalogRuntime.registry,
    refreshCatalog: () => catalogRuntime!.service.refreshCatalog(),
    onGeneralSettingsSaved: (settings) => {
      providerPolicy.replace(settings.enabledProviders);
      localizationService?.setPreference(settings.languagePreference);
    }
  });
  const localePaths = resolveLocalePaths({
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    userDataPath: userDataDirectory
  });
  localizationService = new LocalizationService({
    preference: terminalRuntime.getGeneralSettings().languagePreference,
    preferredSystemLanguages: app.getPreferredSystemLanguages(),
    ...localePaths
  });
  remoteWindowStateManager = await createSharedWindowStateManager({
    statePath: join(app.getPath('userData'), 'remote-window-state.json'),
    workAreas: screen.getAllDisplays().map((display) => display.workArea)
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
  const registerLocalTransferWorkspace = async (path: string) => {
    const canonical = await canonicalizeWorkspacePath(path, { platform });
    const snapshot = await catalogRuntime!.service.registerWorkspace(path);
    const workspace = snapshot.workspaces.find(
      (candidate) => candidate.id === canonical.id
    );
    if (workspace === undefined || !workspace.available) {
      throw new Error('The selected workspace could not be registered.');
    }
    return workspace;
  };
  executionTargetGateway.register(
    LOCAL_EXECUTION_TARGET_ID,
    Object.freeze({
      catalog: catalogRuntime.service,
      workspaceVisibility: catalogRuntime.workspaceVisibility,
      terminal: terminalRuntime,
      environmentScanner: developerEnvironmentScanner,
      providers: Object.freeze({
        registry: Object.freeze({ scan: scanEnabledProviders }),
        updates: providerUpdateService
      }),
      transfer: Object.freeze({
        service: transferService,
        registerWorkspace: registerLocalTransferWorkspace
      })
    })
  );
  registerTargetIpc({
    ipc: ipcMain,
    authorize: authorizeTargetIpc,
    service: remoteTargetRuntime.service,
    beforeProfileMutation: (executionTargetId) => {
      targetWindowManager.close(executionTargetId);
    },
    openTargetWindow: async (executionTargetId) => {
      if (remoteTargetRuntime === null) {
        throw new Error('Remote target storage is unavailable.');
      }
      remoteTargetRuntime.service.get(executionTargetId);
      await targetWindowManager.open(executionTargetId);
    },
    resolveWindowClose: resolveRemoteWindowClose
  });
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
    resolveApplicationQuit,
    ...(developmentOrigin === undefined ? {} : { developmentOrigin })
  });
  registerAboutIpc({
    ipc: ipcMain,
    authorize: authorizeTargetIpc,
    platform: process.platform,
    arch: process.arch,
    appVersion: app.getVersion(),
    release: applicationReleaseRuntime.service,
    openProject: (url) => shell.openExternal(url)
  });
  registerDiagnosticIpc({
    ipc: ipcMain,
    authorize: authorizeLocalIpc,
    service: diagnosticService,
    storage: diagnosticPreferencesStore!,
    chooseDirectory: async (kind, currentDirectory) => {
      const result = await dialog.showOpenDialog({
        title: kind === 'journal'
          ? 'Choose diagnostic journal folder'
          : 'Choose diagnostic export folder',
        defaultPath: currentDirectory,
        properties: ['openDirectory', 'createDirectory']
      });
      return result.canceled || result.filePaths.length !== 1
        ? null
        : result.filePaths[0]!;
    }
  });
  registerEnvironmentIpc({
    ipc: ipcMain,
    authorize: authorizeLocalIpc,
    resolveScanner: (context) =>
      executionTargetGateway.resolve(context).environmentScanner,
    openExternal: (url) => shell.openExternal(url),
    ...(developmentOrigin === undefined ? {} : { developmentOrigin })
  });
  registerProviderIpc({
    ipc: ipcMain,
    authorize: authorizeTargetIpc,
    resolveServices: (context) => {
      if (context.executionTargetId === LOCAL_EXECUTION_TARGET_ID) {
        return executionTargetGateway.resolve(context).providers;
      }
      if (remoteTargetRuntime === null) {
        throw new Error('Remote target storage is unavailable.');
      }
      const executionTargetId = RemoteExecutionTargetIdSchema.parse(
        context.executionTargetId
      );
      return {
        registry: {
          scan: async () => (
            await remoteTargetRuntime!.service.scanDiscovery(executionTargetId)
          ).providers
        },
        updates: {
          check: () => remoteTargetRuntime!.service.checkProviderUpdates(
            executionTargetId
          ),
          install: (provider: ProviderId) =>
            remoteTargetRuntime!.service.installProvider(
              executionTargetId,
              provider
            ),
          update: (provider: ProviderId) =>
            remoteTargetRuntime!.service.updateProvider(
              executionTargetId,
              provider
            )
        }
      };
    },
    openExternal: (url) => shell.openExternal(url),
    ...(developmentOrigin === undefined ? {} : { developmentOrigin })
  });
  registerCatalogIpc({
    ipc: ipcMain,
    authorize: authorizeLocalIpc,
    resolveService: (context) =>
      executionTargetGateway.resolve(context).catalog,
    showOpenDialog: (options) => dialog.showOpenDialog(options),
    onCatalogRefreshed: () => {
      terminalRuntime!.synchronizeCatalogSessions();
      trayController?.refresh();
    },
    ...(developmentOrigin === undefined ? {} : { developmentOrigin })
  });
  registerWorkspaceVisibilityIpc({
    ipc: ipcMain,
    authorize: authorizeTargetIpc,
    resolveService: (context) => {
      if (context.executionTargetId === LOCAL_EXECUTION_TARGET_ID) {
        return executionTargetGateway.resolve(context).workspaceVisibility;
      }
      if (remoteTargetRuntime === null) {
        throw new Error('Remote target storage is unavailable.');
      }
      return remoteTargetRuntime.service.resolveSessionRuntime(
        RemoteExecutionTargetIdSchema.parse(context.executionTargetId)
      ).workspaceVisibility;
    },
    ...(developmentOrigin === undefined ? {} : { developmentOrigin })
  });
  registerTransferIpc({
    ipc: ipcMain,
    authorize: authorizeLocalIpc,
    resolveTarget: (context) =>
      executionTargetGateway.resolve(context).transfer,
    downloadsDirectory: app.getPath('downloads'),
    lastDirectory: (direction) =>
      transferRuntime!.repository.getLastDirectory(direction),
    showSaveDialog: (options) => dialog.showSaveDialog(options),
    showOpenDialog: (options) => dialog.showOpenDialog(options),
    ...(developmentOrigin === undefined ? {} : { developmentOrigin })
  });
  const localTerminalImageStager = new TerminalImageStager({
    rootDirectory: join(
      app.getPath('temp'),
      'Lumora',
      'terminal-images',
      'local'
    )
  });
  void localTerminalImageStager
    .cleanupStale({ maxDirectories: 100 })
    .catch(() => undefined);
  const terminalClipboardService = createTerminalClipboardService({
    clipboard: {
      readImage: () => clipboard.readImage(),
      readText: () => clipboard.readText()
    },
    resolveTarget: (context) => {
      if (context.executionTargetId === LOCAL_EXECUTION_TARGET_ID) {
        return {
          platform,
          listRuntimes: () => terminalRuntime!.listRuntimes(),
          stageImage: ({ runtimeId, png, width, height }) =>
            localTerminalImageStager.stageLocal({
              runtimeId,
              png,
              width,
              height,
              platform
            })
        };
      }
      if (remoteTargetRuntime === null) {
        throw new Error('Remote target storage is unavailable.');
      }
      const executionTargetId = RemoteExecutionTargetIdSchema.parse(
        context.executionTargetId
      );
      const remotePlatform = remoteTargetRuntime.service.get(executionTargetId)
        .target.platform;
      if (remotePlatform === 'unknown') {
        throw new Error('The remote target platform is unavailable.');
      }
      return {
        platform: remotePlatform,
        listRuntimes: () =>
          remoteTargetRuntime!.service
            .resolveSessionRuntime(executionTargetId)
            .listRuntimes(),
        stageImage: ({ runtimeId, png }) =>
          remoteTargetRuntime!.service.stageTerminalImage(
            executionTargetId,
            runtimeId,
            png
          )
      };
    }
  });
  registerClipboardIpc({
    ipc: ipcMain,
    authorize: authorizeTargetIpc,
    clipboard: {
      readText: () => clipboard.readText(),
      writeText: (text) => clipboard.writeText(text)
    },
    readTerminalClipboard: (context, request) =>
      terminalClipboardService.read(context, request.runtimeId),
    ...(developmentOrigin === undefined ? {} : { developmentOrigin })
  });
  registerAppearanceIpc({
    ipc: ipcMain,
    authorizeRead: authorizeTargetIpc,
    authorizeWrite: authorizeLocalIpc,
    service: appearanceBackgroundStore,
    getAppearanceSettings: () => terminalRuntime!.getGeneralSettings().appearance,
    showOpenDialog: (options) => dialog.showOpenDialog(options),
    ...(developmentOrigin === undefined ? {} : { developmentOrigin })
  });
  unsubscribeLocalizationEvents = registerLocalizationIpc({
    ipc: ipcMain,
    authorize: authorizeTargetIpc,
    service: localizationService,
    openUserLocaleFolder: async () => {
      await mkdir(localePaths.userRoot, { recursive: true });
      const error = await shell.openPath(localePaths.userRoot);
      if (error !== '') throw new Error(error);
    },
    broadcast: (snapshot) => {
      if (mainWindow !== null && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.localizationChanged, snapshot);
      }
      targetWindowManager.broadcast(IPC_CHANNELS.localizationChanged, snapshot);
      trayController?.refresh();
      configureApplicationMenu(Menu, { platform });
    },
    ...(developmentOrigin === undefined ? {} : { developmentOrigin })
  });
  unsubscribeTerminalEvents = registerTerminalIpc({
    ipc: ipcMain,
    authorize: authorizeTargetIpc,
    resolveRuntime: (context) => {
      if (context.executionTargetId === LOCAL_EXECUTION_TARGET_ID) {
        return executionTargetGateway.resolve(context).terminal;
      }
      if (remoteTargetRuntime === null) {
        throw new Error('Remote target storage is unavailable.');
      }
      return remoteTargetRuntime.service.resolveSessionRuntime(
        RemoteExecutionTargetIdSchema.parse(context.executionTargetId)
      );
    },
    subscribeRuntimeEvents: (listener) => terminalRuntime!.subscribe(listener),
    openExternal: (url) => shell.openExternal(url),
    sendGeneralSettingsChanged: () => {
      localizationService?.setPreference(
        terminalRuntime!.getGeneralSettings().languagePreference
      );
      broadcastGeneralSettingsChanged();
    },
    sendRuntimeEvent: (event) => {
      if (event.type === 'state') {
        trayController?.refresh();
        if (
          event.runtime.state !== 'launching' &&
          event.runtime.state !== 'running'
        ) {
          void localTerminalImageStager
            .cleanupRuntime(event.runtimeId)
            .catch(() => undefined);
        }
      }
      if (mainWindow !== null && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.runtimeEvent, event);
      }
    },
    ...(developmentOrigin === undefined ? {} : { developmentOrigin })
  });
  unsubscribeRemoteTerminalEvents =
    remoteTargetRuntime.service.subscribeSessionRuntimeEvents(
      (executionTargetId, event) => {
        if (
          event.type === 'state' &&
          event.runtime.state !== 'launching' &&
          event.runtime.state !== 'running'
        ) {
          void remoteTargetRuntime?.service
            .cleanupTerminalImages(executionTargetId, event.runtimeId)
            .catch(() => undefined);
        }
        targetWindowManager.send(
          executionTargetId,
          IPC_CHANNELS.runtimeEvent,
          event
        );
      }
    );
  unsubscribeRemoteLifecycleEvents =
    remoteTargetRuntime.service.subscribeLifecycle((event) => {
      if (mainWindow !== null && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.remoteLifecycleEvent, event);
      }
      targetWindowManager.send(
        event.executionTargetId,
        IPC_CHANNELS.remoteLifecycleEvent,
        event
      );
    });

  await mainWindowCreation.ensureCreated();
  createApplicationTray();
  await diagnosticService.record({
    severity: 'info',
    subsystem: 'startup',
    operation: 'application-start',
    outcome: 'succeeded',
    targetKind: 'local'
  });

  app.on('activate', () => {
    void showOrCreateMainWindow();
  });
}).catch((error) => {
  void diagnosticService?.record({
    severity: 'error',
    subsystem: 'startup',
    operation: 'application-start',
    outcome: 'failed',
    targetKind: 'local',
    code: 'STARTUP_FAILED'
  });
  console.error('Unable to initialize Lumora.', error);
  if (!shutdownStarted) {
    app.quit();
  }
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
  if (!applicationQuitApproved) {
    let localActiveAgentCount = 0;
    let remoteActiveAgentCount = 0;
    try {
      localActiveAgentCount = countActiveTerminalRuntimes(
        terminalRuntime?.listRuntimes() ?? []
      );
      remoteActiveAgentCount = remoteTargetRuntime?.service
        .listLifecycleSnapshots()
        .reduce((count, snapshot) => count + snapshot.activeTerminalCount, 0) ?? 0;
    } catch (error) {
      console.error('Lumora could not inspect active agents before exit.', error);
    }
    const result = applicationQuitGuard.request({
      warn: terminalRuntime?.getGeneralSettings().warnBeforeApplicationQuit ?? true,
      counts: {
        localActiveAgentCount,
        remoteActiveAgentCount,
        totalActiveAgentCount: localActiveAgentCount + remoteActiveAgentCount
      }
    });
    if (result === 'pending') {
      event.preventDefault();
      return;
    }
  }
  event.preventDefault();
  shutdownStarted = true;
  const runtime = terminalRuntime;
  const remoteRuntime = remoteTargetRuntime;
  const transfer = transferRuntime;
  const releaseRuntime = applicationReleaseRuntime;
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
          remoteRuntime?.close() ?? Promise.resolve(),
          releaseRuntime?.close() ?? Promise.resolve(),
          flushWindowState(),
          flushRemoteWindowState()
        ]);
        if (remoteTargetRuntime === remoteRuntime) {
          remoteTargetRuntime = null;
        }
        if (applicationReleaseRuntime === releaseRuntime) {
          applicationReleaseRuntime = null;
        }
      } catch (error) {
        shutdownErrors.push(error);
      }
      if (shutdownErrors.length > 0) {
        throw shutdownErrors[0];
      }
      await diagnosticService?.record({
        severity: 'info',
        subsystem: 'application',
        operation: 'application-stop',
        outcome: 'succeeded',
        targetKind: 'local'
      }).catch(() => undefined);
      await diagnosticJournal?.finishRun();
    } catch (error) {
      console.error('Unable to complete Lumora shutdown cleanly.', error);
    } finally {
      targetWindowManager.closeAll();
      void remoteTargetRuntime?.close();
      remoteTargetRuntime = null;
      await releaseRuntime?.close();
      applicationReleaseRuntime = null;
      unsubscribeRemoteTerminalEvents?.();
      unsubscribeRemoteTerminalEvents = null;
      unsubscribeRemoteLifecycleEvents?.();
      unsubscribeRemoteLifecycleEvents = null;
      unsubscribeTerminalEvents?.();
      unsubscribeTerminalEvents = null;
      unsubscribeLocalizationEvents?.();
      unsubscribeLocalizationEvents = null;
      runtime?.close();
      if (terminalRuntime === runtime) {
        terminalRuntime = null;
      }
      catalogRuntime?.close();
      catalogRuntime = null;
      disposeDiagnosticProcessObservers?.();
      disposeDiagnosticProcessObservers = null;
      app.quit();
    }
  })();
});

app.on('will-quit', () => {
  targetWindowManager.closeAll();
  void remoteTargetRuntime?.close();
  remoteTargetRuntime = null;
  void applicationReleaseRuntime?.close();
  applicationReleaseRuntime = null;
  unsubscribeRemoteTerminalEvents?.();
  unsubscribeRemoteTerminalEvents = null;
  unsubscribeRemoteLifecycleEvents?.();
  unsubscribeRemoteLifecycleEvents = null;
  trayController?.dispose();
  trayController = null;
  unsubscribeTerminalEvents?.();
  unsubscribeTerminalEvents = null;
  unsubscribeLocalizationEvents?.();
  unsubscribeLocalizationEvents = null;
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
