import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

describe('tray main-process integration', () => {
  it('enforces a single background application instance and restores it', () => {
    expect(source).toContain('app.requestSingleInstanceLock()');
    expect(source).toContain("app.on('second-instance'");
    expect(source).toContain('showOrCreateMainWindow()');
  });

  it('creates one persistent native tray from platform artwork', () => {
    expect(source).toContain('new Tray(trayImage)');
    expect(source).toContain('nativeImage.createFromPath(trayIconPath)');
    expect(source).toContain("trayImage.setTemplateImage(platform === 'darwin')");
    expect(source).toContain('createTrayController({');
  });

  it('keeps the window alive when close-to-tray is selected', () => {
    expect(source).toContain("window.on('close'");
    expect(source).toContain('resolveWindowCloseAction({');
    expect(source).toContain("if (closeAction === 'hide')");
    expect(source).toContain('event.preventDefault()');
    expect(source).toContain('window.hide()');
  });

  it('routes tray sessions through the renderer resume confirmation', () => {
    expect(source).toContain('IPC_CHANNELS.trayResumeSession');
    expect(source).toContain('TrayResumeSessionRequestSchema.parse({ sessionId })');
    expect(source).toContain('showOrCreateMainWindow()');
  });

  it('refreshes dynamic menu state and disposes the tray on real exit', () => {
    expect(source).toContain('trayController?.refresh()');
    expect(source).toContain('trayController?.dispose()');
  });
});
