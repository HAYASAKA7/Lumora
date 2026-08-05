import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

describe('window-state main-process integration', () => {
  it('resolves state only after development user-data isolation and readiness', () => {
    expect(source.indexOf('configureDevelopmentDataPaths(app)')).toBeLessThan(
      source.indexOf('app.whenReady()')
    );
    expect(source).toContain(
      "join(app.getPath('userData'), 'window-state.json')"
    );
    expect(source).toContain('screen.getAllDisplays()');
    expect(source.indexOf('await loadWindowRestore(')).toBeGreaterThan(
      source.indexOf('async function prepareMainWindow')
    );
  });

  it('attaches state tracking and maximizes the hidden window before show', () => {
    const loadState = source.indexOf('await loadWindowRestore(');
    const createWindow = source.indexOf('new BrowserWindow(', loadState);
    const attachManager = source.indexOf(
      'createWindowStateManager({',
      createWindow
    );
    const maximize = source.indexOf('window.maximize()', attachManager);
    const readyToShow = source.indexOf(
      "window.once('ready-to-show'",
      maximize
    );

    expect(loadState).toBeGreaterThan(-1);
    expect(createWindow).toBeGreaterThan(loadState);
    expect(source.slice(createWindow, attachManager)).toContain(
      'restore.normalBounds'
    );
    expect(attachManager).toBeGreaterThan(createWindow);
    expect(maximize).toBeGreaterThan(attachManager);
    expect(readyToShow).toBeGreaterThan(maximize);
  });

  it('applies the saved startup maximization preference to restored state', () => {
    expect(source).toContain('applyStartupMaximization(');
    expect(source).toContain(
      'terminalRuntime?.getGeneralSettings().startMaximized'
    );
  });

  it('releases startup presentation only after the real window is shown', () => {
    const readyToShow = source.indexOf("window.once('ready-to-show'");
    const show = source.indexOf('window.show()', readyToShow);
    const markWindowShown = source.indexOf(
      'startupPresentation.markWindowShown()',
      show
    );

    expect(readyToShow).toBeGreaterThan(-1);
    expect(show).toBeGreaterThan(readyToShow);
    expect(markWindowShown).toBeGreaterThan(show);
  });

  it('keeps only the claimed startup presentation active in the background', () => {
    const createWindow = source.indexOf('new BrowserWindow(');
    const createBackgroundActivity = source.indexOf(
      'createStartupBackgroundActivityController(window.webContents)',
      createWindow
    );
    const readyToShow = source.indexOf(
      "window.once('ready-to-show'",
      createBackgroundActivity
    );
    const show = source.indexOf('window.show()', readyToShow);
    const closed = source.indexOf("window.on('closed'", readyToShow);
    const dispose = source.indexOf(
      'startupBackgroundActivity.dispose()',
      closed
    );

    expect(createBackgroundActivity).toBeGreaterThan(createWindow);
    expect(readyToShow).toBeGreaterThan(createBackgroundActivity);
    const prepareStartup = source.indexOf(
      'startupPresentation.isClaimAvailable()',
      createBackgroundActivity
    );
    const startBeforeFirstPaint = source.indexOf(
      'startupBackgroundActivity.start()',
      prepareStartup
    );
    expect(prepareStartup).toBeGreaterThan(createBackgroundActivity);
    expect(startBeforeFirstPaint).toBeLessThan(readyToShow);
    expect(source).toContain(
      'activeStartupBackgroundActivity = startupBackgroundActivity'
    );
    const claim = source.indexOf(
      'claimStartupPresentation: async (senderId)'
    );
    const captureController = source.indexOf(
      'const startupBackgroundActivity =',
      claim
    );
    const awaitClaim = source.indexOf(
      'await startupPresentation.claim()',
      captureController
    );
    const start = source.indexOf(
      'startupBackgroundActivity?.start()',
      awaitClaim
    );

    expect(claim).toBeGreaterThan(-1);
    expect(captureController).toBeGreaterThan(claim);
    expect(awaitClaim).toBeGreaterThan(captureController);
    expect(start).toBeGreaterThan(awaitClaim);
    expect(source).toContain(
      'activeStartupBackgroundActivityId === senderId'
    );
    expect(source).toContain('completeStartupPresentation: (senderId)');
    expect(dispose).toBeGreaterThan(closed);
  });

  it('serializes main-window preparation and blocks commitment during shutdown', () => {
    expect(source).toContain('createSingleWindowCreationGate({');
    expect(source).toContain(
      'canCreate: () => !shutdownStarted && mainWindow === null'
    );
    expect(source).toContain('mainWindowCreation.ensureCreated()');
    expect(source).not.toContain('void createMainWindow()');
  });

  it('binds closed-window persistence to that window manager', () => {
    expect(source).toContain(
      'const windowStateManager = createWindowStateManager({'
    );
    expect(source).toContain(
      'if (activeWindowStateManager === windowStateManager)'
    );
    expect(source).toContain(
      'queueWindowStateFlush(windowStateManager.dispose())'
    );
  });

  it('includes final window persistence in orderly asynchronous shutdown', () => {
    expect(source).toContain('function flushWindowState()');
    expect(source).toContain('activeWindowStateManager?.dispose()');
    expect(source).toContain('await Promise.all([');
    expect(source).toContain('flushWindowState()');
    expect(source.indexOf('await Promise.all([')).toBeLessThan(
      source.lastIndexOf('app.quit()')
    );
  });

  it('still completes application cleanup when asynchronous shutdown rejects', () => {
    const awaitShutdown = source.indexOf('await Promise.all([');
    const quit = source.lastIndexOf('app.quit()');
    const shutdownBlock = source.slice(
      source.lastIndexOf('void (async () => {', awaitShutdown),
      quit
    );

    expect(shutdownBlock).toContain('try {');
    expect(shutdownBlock).toContain('} finally {');
  });

  it('does not read webContents from an already destroyed window', () => {
    const closed = source.slice(
      source.indexOf("window.on('closed'"),
      source.indexOf('if (developmentOrigin', source.indexOf("window.on('closed'"))
    );

    expect(closed).toContain(
      'windowContexts.unregister(startupBackgroundActivityId)'
    );
    expect(closed).not.toContain('window.webContents.id');
  });
});
