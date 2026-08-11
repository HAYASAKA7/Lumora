import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');

describe('remote target application integration', () => {
  it('composes target storage, target-aware IPC, and immutable remote windows', () => {
    expect(mainSource).toContain('createRemoteTargetRuntime({');
    expect(mainSource).toContain('createIpcAuthorizer({');
    expect(mainSource).toContain('createTargetWindowManager({');
    expect(mainSource).toContain('registerTargetIpc({');
    expect(mainSource).toContain('remoteTargetRuntime.service.get(executionTargetId)');
    expect(mainSource).toContain('targetWindowManager.open(executionTargetId)');
    expect(mainSource).toContain('authorize: authorizeTargetIpc');
    expect(mainSource).toContain('service.checkProviderUpdates(');
    expect(mainSource).toContain('service.installProvider(');
    expect(mainSource).toContain('service.updateProvider(');
  });

  it('closes target windows and SSH clients during application shutdown', () => {
    const shutdown = mainSource.slice(mainSource.indexOf("app.on('before-quit'"));
    expect(shutdown).toContain('targetWindowManager.closeAll()');
    expect(shutdown).toContain('remoteTargetRuntime?.close()');
  });

  it('publishes authoritative lifecycle updates to local and target windows', () => {
    expect(mainSource).toContain(
      'remoteTargetRuntime.service.subscribeLifecycle((event) => {'
    );
    expect(mainSource).toContain(
      'mainWindow.webContents.send(IPC_CHANNELS.remoteLifecycleEvent, event)'
    );
    expect(mainSource).toContain(
      'IPC_CHANNELS.remoteLifecycleEvent,\n        event'
    );
    expect(mainSource).toContain('unsubscribeRemoteLifecycleEvents?.()');
  });

  it('keeps remote connections by default and confirms active disconnects', () => {
    expect(mainSource).toContain('onCloseRequested: (executionTargetId, event) => {');
    expect(mainSource).toContain('remoteWindowCloseBehavior');
    expect(mainSource).toContain("'disconnect'");
    expect(mainSource).toContain('IPC_CHANNELS.remoteWindowCloseRequest');
    expect(mainSource).toContain('resolveRemoteWindowClose');
  });

  it('stops startup composition during shutdown and handles initialization failures', () => {
    const startup = mainSource.slice(
      mainSource.indexOf('if (hasSingleInstanceLock)')
    );
    const environmentResolved = startup.indexOf(
      'applicationEnvironment = await resolveApplicationEnvironment({'
    );
    const shutdownGuard = startup.indexOf('if (shutdownStarted) return;');
    const remoteRuntime = startup.indexOf('createRemoteTargetRuntime({');

    expect(shutdownGuard).toBeGreaterThan(environmentResolved);
    expect(remoteRuntime).toBeGreaterThan(shutdownGuard);
    expect(startup).toContain('.catch((error) => {');
    expect(startup).toContain(
      "console.error('Unable to initialize Lumora.', error)"
    );
  });
});
