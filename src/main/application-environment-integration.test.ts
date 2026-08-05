import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const terminalRuntimeSource = readFileSync(
  new URL('./terminal/terminal-runtime.ts', import.meta.url),
  'utf8'
);

describe('application environment integration', () => {
  it('recovers the POSIX GUI PATH before scanning providers or creating runtimes', () => {
    const resolveEnvironment = mainSource.indexOf(
      'applicationEnvironment = await resolveApplicationEnvironment({'
    );
    const createCatalog = mainSource.indexOf('createCatalogRuntime({');
    const createTerminal = mainSource.indexOf('createTerminalRuntime({');

    expect(resolveEnvironment).toBeGreaterThan(-1);
    expect(createCatalog).toBeGreaterThan(resolveEnvironment);
    expect(createTerminal).toBeGreaterThan(resolveEnvironment);
    expect(mainSource).toContain(
      'findExecutable(command, { platform, env: applicationEnvironment })'
    );
    expect(mainSource).toContain(
      'probeVersion(executablePath, {'
    );
    expect(mainSource).toContain('env: applicationEnvironment,');
    expect(mainSource.match(/env: process\.env/g)).toHaveLength(1);
  });

  it('routes the recovered environment into terminal profile detection and launches', () => {
    expect(mainSource).toContain(
      'terminalRuntime = await createTerminalRuntime({'
    );
    expect(mainSource.slice(mainSource.indexOf('terminalRuntime = await'))).toContain(
      'env: applicationEnvironment'
    );
    expect(terminalRuntimeSource).toMatch(
      /detectTerminalProfiles\(\{\s+platform,\s+env,/
    );
    expect(terminalRuntimeSource).toContain(
      'findExecutable(command, { platform, env })'
    );
  });
  it('composes session transfer after recovered environment, catalog, and terminal runtimes', () => {
    const resolveEnvironment = mainSource.indexOf(
      'applicationEnvironment = await resolveApplicationEnvironment({'
    );
    const createCatalog = mainSource.indexOf('createCatalogRuntime({');
    const createTerminal = mainSource.indexOf('createTerminalRuntime({');
    const createTransfer = mainSource.indexOf('createSessionTransferRuntime({');

    expect(createTransfer).toBeGreaterThan(resolveEnvironment);
    expect(createTransfer).toBeGreaterThan(createCatalog);
    expect(createTransfer).toBeGreaterThan(createTerminal);
    const transferComposition = mainSource.slice(createTransfer);
    expect(transferComposition).toContain(
      'adapters: catalogRuntime.transferRegistry'
    );
    expect(transferComposition).toContain(
      'activeSessions: () => terminalRuntime!.activeTransferSessions()'
    );
    expect(transferComposition).toContain('scanProviders: scanEnabledProviders');
    expect(transferComposition).toContain(
      'mainWindow.webContents.send(IPC_CHANNELS.transferEvent, event)'
    );
    expect(mainSource).toContain('registerTransferIpc({');
  });

  it('enables explicitly labelled experimental transfer routes in release builds', () => {
    expect(mainSource).toContain('allowExperimentalTransferRoutes: true');
    expect(mainSource).not.toContain('allowExperimentalTransferRoutes: !app.isPackaged');
  });

  it('closes session transfer before terminal and catalog database owners', () => {
    const beforeQuit = mainSource.slice(mainSource.indexOf("app.on('before-quit'"));
    const closeTransfer = beforeQuit.indexOf('await transfer?.close()');
    const closeTerminal = beforeQuit.indexOf('runtime?.close()');
    const closeCatalog = beforeQuit.indexOf('catalogRuntime?.close()');

    expect(closeTransfer).toBeGreaterThan(-1);
    expect(closeTerminal).toBeGreaterThan(closeTransfer);
    expect(closeCatalog).toBeGreaterThan(closeTerminal);
  });
});
