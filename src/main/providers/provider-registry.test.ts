import { describe, expect, it, vi } from 'vitest';

import type { ProviderInstallation } from '../../shared/contracts';
import { createClaudeAdapter } from './claude-adapter';
import { createCodexAdapter } from './codex-adapter';
import type { ProviderAdapter } from './provider-adapter';
import { ProviderRegistry } from './provider-registry';

const readyCodex: ProviderInstallation = {
  provider: 'codex',
  displayName: 'Codex',
  state: 'ready',
  executablePath: '/tools/codex',
  version: 'codex-cli 1.2.3',
  issue: null
};

const readyClaude: ProviderInstallation = {
  provider: 'claude',
  displayName: 'Claude Code',
  state: 'ready',
  executablePath: '/tools/claude',
  version: '2.3.4 (Claude Code)',
  issue: null
};

describe('provider adapters', () => {
  it('detects and version-probes Codex through the shared dependencies', async () => {
    const findExecutable = vi.fn(async () => '/tools/codex');
    const probeVersion = vi.fn(async () => 'codex-cli 1.2.3');
    const adapter = createCodexAdapter({ findExecutable, probeVersion });

    await expect(adapter.scan()).resolves.toEqual(readyCodex);
    expect(findExecutable).toHaveBeenCalledWith('codex');
    expect(probeVersion).toHaveBeenCalledWith('/tools/codex');
  });

  it('returns an actionable missing state for Claude Code', async () => {
    const adapter = createClaudeAdapter({
      findExecutable: async () => null,
      probeVersion: async () => {
        throw new Error('must not run');
      }
    });

    await expect(adapter.scan()).resolves.toEqual({
      provider: 'claude',
      displayName: 'Claude Code',
      state: 'not_found',
      executablePath: null,
      version: null,
      issue: {
        code: 'PROVIDER_NOT_FOUND',
        message: 'Claude Code was not found on PATH.',
        recovery: 'Install Claude Code or add it to PATH, then refresh.',
        retryable: true
      }
    });
  });

  it('retains the executable path when a version probe fails', async () => {
    const adapter = createCodexAdapter({
      findExecutable: async () => 'C:\\tools\\codex.cmd',
      probeVersion: async () => {
        throw new Error('process detail must not cross IPC');
      }
    });

    await expect(adapter.scan()).resolves.toEqual({
      provider: 'codex',
      displayName: 'Codex',
      state: 'probe_failed',
      executablePath: 'C:\\tools\\codex.cmd',
      version: null,
      issue: {
        code: 'PROVIDER_VERSION_PROBE_FAILED',
        message: 'Lumora found Codex but could not read its version.',
        recovery: 'Run codex --version in a terminal, then refresh.',
        retryable: true
      }
    });
  });

  it('normalizes locator failures without exposing exception details', async () => {
    const adapter = createClaudeAdapter({
      findExecutable: async () => {
        throw new Error('sensitive PATH detail');
      },
      probeVersion: async () => 'unused'
    });

    await expect(adapter.scan()).resolves.toMatchObject({
      provider: 'claude',
      state: 'probe_failed',
      executablePath: null,
      issue: {
        code: 'PROVIDER_SCAN_FAILED',
        message: 'Lumora could not scan Claude Code.'
      }
    });
  });
});

describe('ProviderRegistry', () => {
  it('keeps Codex then Claude order when adapters resolve out of order', async () => {
    let resolveCodex!: (value: ProviderInstallation) => void;
    let resolveClaude!: (value: ProviderInstallation) => void;
    const codexResult = new Promise<ProviderInstallation>((resolve) => {
      resolveCodex = resolve;
    });
    const claudeResult = new Promise<ProviderInstallation>((resolve) => {
      resolveClaude = resolve;
    });
    const registry = new ProviderRegistry(
      {
        codex: { ...adapterIdentity('codex', 'Codex'), scan: () => codexResult },
        claude: {
          ...adapterIdentity('claude', 'Claude Code'),
          scan: () => claudeResult
        }
      },
      () => new Date('2026-07-11T01:02:03.000Z')
    );

    const scanPromise = registry.scan();
    resolveClaude(readyClaude);
    resolveCodex(readyCodex);

    await expect(scanPromise).resolves.toEqual({
      scannedAt: '2026-07-11T01:02:03.000Z',
      providers: [readyCodex, readyClaude]
    });
  });

  it('isolates an unexpected adapter failure to that provider', async () => {
    const registry = new ProviderRegistry(
      {
        codex: {
          ...adapterIdentity('codex', 'Codex'),
          scan: async () => {
            throw new Error('unexpected Codex failure');
          }
        },
        claude: { ...adapterIdentity('claude', 'Claude Code'), scan: async () => readyClaude }
      },
      () => new Date('2026-07-11T01:02:03.000Z')
    );

    const result = await registry.scan();

    expect(result.providers[0]).toMatchObject({
      provider: 'codex',
      state: 'probe_failed',
      executablePath: null,
      issue: { code: 'PROVIDER_SCAN_FAILED' }
    });
    expect(result.providers[1]).toEqual(readyClaude);
  });
});

function adapterIdentity(
  provider: ProviderAdapter['provider'],
  displayName: string
): Pick<ProviderAdapter, 'provider' | 'displayName'> {
  return { provider, displayName };
}
