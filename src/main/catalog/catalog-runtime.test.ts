import { describe, expect, it } from 'vitest';

import type { ProviderScanResult } from '../../shared/contracts';
import { createCatalogRuntime } from './catalog-runtime';

const unavailableProviders: ProviderScanResult = {
  scannedAt: '2026-07-11T03:00:00.000Z',
  providers: [
    {
      provider: 'codex',
      displayName: 'Codex',
      state: 'not_found',
      executablePath: null,
      version: null,
      issue: {
        code: 'PROVIDER_NOT_FOUND',
        message: 'Codex was not found.',
        recovery: 'Install Codex, then refresh.',
        retryable: true
      }
    },
    {
      provider: 'claude',
      displayName: 'Claude Code',
      state: 'not_found',
      executablePath: null,
      version: null,
      issue: {
        code: 'PROVIDER_NOT_FOUND',
        message: 'Claude Code was not found.',
        recovery: 'Install Claude Code, then refresh.',
        retryable: true
      }
    }
  ]
};

const testPlatform =
  process.platform === 'win32'
    ? 'win32'
    : process.platform === 'darwin'
      ? 'darwin'
      : 'linux';

describe('createCatalogRuntime', () => {
  it('composes a migrated catalog and closes its database idempotently', async () => {
    const runtime = createCatalogRuntime({
      databasePath: ':memory:',
      homeDirectory: process.cwd(),
      platform: testPlatform,
      env: {},
      scanProviders: async () => unavailableProviders,
      clock: () => new Date('2026-07-11T03:00:00.000Z'),
      createScanId: () => 'scan-1'
    });

    const snapshot = await runtime.service.registerWorkspace(process.cwd());

    expect(snapshot.workspaces).toHaveLength(1);
    expect(snapshot.workspaces[0]).toMatchObject({
      available: true,
      origin: 'manual'
    });
    expect(runtime.registry.providers()).toEqual([
      'codex',
      'claude',
      'gemini',
      'opencode',
      'copilot',
      'qwen'
    ]);
    expect(runtime.registry.get('aider')).toBeNull();
    expect(runtime.close).not.toThrow();
    expect(runtime.close).not.toThrow();
  });
});
