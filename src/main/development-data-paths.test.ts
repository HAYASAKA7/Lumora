import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  configureDevelopmentDataPaths,
  toDevelopmentDataPath
} from './development-data-paths';

describe('development data paths', () => {
  it('creates and applies one isolated path to user and session data', () => {
    const calls: string[] = [];
    const app = {
      isPackaged: false,
      getPath: vi.fn(() =>
        'C:\\Users\\tester\\AppData\\Roaming\\agent-workspace-manager'
      ),
      setPath: vi.fn((name: string) => calls.push(name))
    };

    configureDevelopmentDataPaths(app, (path) => calls.push(`mkdir:${path}`));

    const developmentPath =
      'C:\\Users\\tester\\AppData\\Roaming\\agent-workspace-manager-dev';
    expect(calls).toEqual([
      `mkdir:${developmentPath}`,
      'userData',
      'sessionData'
    ]);
    expect(app.setPath).toHaveBeenNthCalledWith(1, 'userData', developmentPath);
    expect(app.setPath).toHaveBeenNthCalledWith(
      2,
      'sessionData',
      developmentPath
    );
  });

  it('does not inspect or override packaged paths', () => {
    const app = {
      isPackaged: true,
      getPath: vi.fn(() => 'packaged-data'),
      setPath: vi.fn()
    };
    const ensureDirectory = vi.fn();

    configureDevelopmentDataPaths(app, ensureDirectory);

    expect(app.getPath).not.toHaveBeenCalled();
    expect(app.setPath).not.toHaveBeenCalled();
    expect(ensureDirectory).not.toHaveBeenCalled();
  });

  it('does not append the development suffix twice', () => {
    expect(toDevelopmentDataPath('C:\\data\\agent-workspace-manager-dev')).toBe(
      'C:\\data\\agent-workspace-manager-dev'
    );
  });

  it('configures paths before Electron readiness', async () => {
    const source = await readFile(resolve('src/main/index.ts'), 'utf8');
    const configuration = source.indexOf('configureDevelopmentDataPaths(app);');
    const readiness = source.indexOf('app.whenReady()');

    expect(configuration).toBeGreaterThan(-1);
    expect(readiness).toBeGreaterThan(-1);
    expect(configuration).toBeLessThan(readiness);
  });

  it('composes secure credential storage only after Electron readiness', async () => {
    const source = await readFile(resolve('src/main/index.ts'), 'utf8');
    const readiness = source.indexOf('app.whenReady().then');
    const adapter = source.indexOf('const credentialEncryption', readiness);
    const safeStorageAdapter = source.indexOf('safeStorage', adapter);
    const remoteRuntime = source.indexOf('createRemoteTargetRuntime({', readiness);

    expect(readiness).toBeGreaterThan(-1);
    expect(adapter).toBeGreaterThan(readiness);
    expect(safeStorageAdapter).toBeGreaterThan(adapter);
    expect(remoteRuntime).toBeGreaterThan(safeStorageAdapter);
    expect(source.slice(remoteRuntime, remoteRuntime + 300))
      .toContain('credentialEncryption');
  });
});
