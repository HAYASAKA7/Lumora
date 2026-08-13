import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

describe('main window execution target binding', () => {
  it('binds each renderer to the permanent local target and authorizes privileged IPC', () => {
    expect(mainSource).toContain('createWindowContextRegistry()');
    expect(mainSource).toContain('createLocalIpcAuthorizer({');
    expect(mainSource).toContain('windowContexts.register(window.webContents.id, {');
    expect(mainSource).toContain("mode: 'local'");
    expect(mainSource).toContain('executionTargetId: LOCAL_EXECUTION_TARGET_ID');
    expect(mainSource).toContain('windowContexts.unregister(startupBackgroundActivityId)');
    expect(mainSource.match(/authorize: authorizeLocalIpc/g)).toHaveLength(5);
    expect(mainSource).toMatch(
      /registerProviderIpc\(\{[\s\S]*?authorize: authorizeTargetIpc/
    );
    expect(mainSource).toMatch(
      /registerTerminalIpc\(\{[\s\S]*?authorize: authorizeTargetIpc/
    );
    expect(mainSource).toMatch(
      /registerClipboardIpc\(\{[\s\S]*?authorize: authorizeTargetIpc/
    );
    expect(mainSource).toContain('authorizeRead: authorizeTargetIpc');
    expect(mainSource).toContain('authorizeWrite: authorizeLocalIpc');
  });
});
