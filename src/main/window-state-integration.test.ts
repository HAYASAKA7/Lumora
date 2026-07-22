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
});
