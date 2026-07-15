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
      source.indexOf('async function createMainWindow')
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

  it('includes final window persistence in orderly asynchronous shutdown', () => {
    expect(source).toContain('function flushWindowState()');
    expect(source).toContain('activeWindowStateManager?.dispose()');
    expect(source).toContain('await Promise.all([');
    expect(source).toContain('flushWindowState()');
    expect(source.indexOf('await Promise.all([')).toBeLessThan(
      source.lastIndexOf('app.quit()')
    );
  });
});
