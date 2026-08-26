import { describe, expect, it, vi } from 'vitest';

import type { ProviderScanResult } from '../../../shared/contracts';
import type {
  SessionLaunchInfo,
  WorkspaceLaunchInfo
} from '../../storage/terminal-repository';
import { StructuredLaunchResolver } from './structured-launch-resolver';

const workspaceId = 'a'.repeat(64);
const sessionId = 'b'.repeat(64);

function harness() {
  const repository = {
    getWorkspace: vi.fn<() => WorkspaceLaunchInfo | null>(() => ({
      id: workspaceId, canonicalPath: 'C:\\work\\lumora', displayName: 'Lumora', available: true
    })),
    getSession: vi.fn<() => SessionLaunchInfo | null>(() => ({
      id: sessionId, title: 'Native title', nativeId: 'native-codex-1', provider: 'codex' as const,
      workspaceId, sourceFreshness: 'current' as const
    })),
    isWorkspaceTrusted: vi.fn(() => true)
  };
  const scanProviders = vi.fn<() => Promise<ProviderScanResult>>(async () => ({
    scannedAt: '2026-08-27T00:00:00.000Z',
    providers: [{
      provider: 'codex' as const, state: 'ready' as const,
      executablePath: 'C:\\tools\\codex.cmd', version: '1.0.0',
      displayName: 'Codex', issue: null
    }]
  }));
  const resolveProviderExecutable = vi.fn(async () => {
    const scan = await scanProviders();
    const installation = scan.providers.find(({ provider }) => provider === 'codex');
    return installation?.state === 'ready' ? installation.executablePath : null;
  });
  return {
    repository,
    scanProviders,
    resolveProviderExecutable,
    resolver: new StructuredLaunchResolver({ repository, resolveProviderExecutable })
  };
}

describe('StructuredLaunchResolver', () => {
  it('resolves a new session only in an available trusted workspace', async () => {
    const current = harness();
    await expect(current.resolver.resolve({
      strategy: 'new', providerId: 'codex', workspaceId, startPrompt: ''
    })).resolves.toEqual(expect.objectContaining({
      workspaceId,
      catalogSessionId: null,
      nativeSessionId: null,
      workingDirectory: 'C:\\work\\lumora',
      executablePath: 'C:\\tools\\codex.cmd'
    }));
    current.repository.isWorkspaceTrusted.mockReturnValueOnce(false);
    await expect(current.resolver.resolve({
      strategy: 'new', providerId: 'codex', workspaceId, startPrompt: ''
    })).rejects.toMatchObject({ code: 'STRUCTURED_WORKSPACE_NOT_TRUSTED' });
  });

  it('preserves the exact provider-owned native ID when resuming', async () => {
    const current = harness();
    await expect(current.resolver.resolve({
      strategy: 'resume', providerId: 'codex', sessionId, startPrompt: ''
    })).resolves.toEqual(expect.objectContaining({
      catalogSessionId: sessionId,
      nativeSessionId: 'native-codex-1',
      title: 'Native title'
    }));
    expect(current.repository.getWorkspace).toHaveBeenCalledWith(workspaceId);
  });

  it('uses the independently resolved structured executable override', async () => {
    const current = harness();
    current.resolveProviderExecutable.mockResolvedValueOnce('C:\\tools\\codex-app-server.cmd');

    await expect(current.resolver.resolve({
      strategy: 'new', providerId: 'codex', workspaceId, startPrompt: ''
    })).resolves.toMatchObject({
      executablePath: 'C:\\tools\\codex-app-server.cmd'
    });
  });

  it('rejects mismatched, stale, unavailable, or missing installations', async () => {
    const current = harness();
    current.repository.getSession.mockReturnValueOnce({
      id: sessionId, title: 'Wrong provider', nativeId: 'native-1', provider: 'claude',
      workspaceId, sourceFreshness: 'current'
    });
    await expect(current.resolver.resolve({
      strategy: 'resume', providerId: 'codex', sessionId, startPrompt: ''
    })).rejects.toMatchObject({ code: 'STRUCTURED_SESSION_UNAVAILABLE' });

    current.resolveProviderExecutable.mockResolvedValueOnce(null);
    await expect(current.resolver.resolve({
      strategy: 'new', providerId: 'codex', workspaceId, startPrompt: ''
    })).rejects.toMatchObject({ code: 'STRUCTURED_PROVIDER_UNAVAILABLE' });
  });
});
