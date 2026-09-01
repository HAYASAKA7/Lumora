import { describe, expect, it, vi } from 'vitest';

import type { LineJsonRpcTransport } from '../transport/line-json-rpc';
import { createLocalStructuredProviderProbe } from './local-structured-provider-probes';
import type { ReadyStructuredProviderInstallation } from './structured-provider-probe-coordinator';

function ready(
  provider: ReadyStructuredProviderInstallation['provider']
): ReadyStructuredProviderInstallation {
  return {
    provider,
    displayName: provider,
    state: 'ready',
    executablePath: `C:\\tools\\${provider}.cmd`,
    version: '2.1.239',
    issue: null
  };
}

function transportFor(provider: 'codex' | 'acp'): LineJsonRpcTransport {
  return {
    request: vi.fn(async () => provider === 'codex'
      ? { userAgent: 'codex-cli/0.149.1' }
      : {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true }
      }),
    notify: vi.fn(async () => undefined),
    onNotification: () => () => undefined,
    onExit: () => () => undefined,
    close: vi.fn(async () => undefined)
  };
}

describe('local structured provider probes', () => {
  it('uses each provider-owned non-session handshake command', async () => {
    const spawned: Array<{
      path: string;
      args: readonly string[];
      timeout: number;
    }> = [];
    const createTransport = vi.fn((
      path: string,
      args: readonly string[],
      timeout: number
    ) => {
      spawned.push({ path, args, timeout });
      return transportFor(path.includes('codex') ? 'codex' : 'acp');
    });
    const probe = createLocalStructuredProviderProbe({
      platform: 'win32',
      env: { PATH: 'C:\\tools', ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
      createTransport,
      probeClaude: vi.fn()
    });

    await expect(probe(ready('codex'))).resolves.toMatchObject({
      providerId: 'codex',
      state: 'verified'
    });
    await expect(probe(ready('gemini'))).resolves.toMatchObject({
      providerId: 'gemini',
      state: 'verified'
    });
    for (const provider of [
      'opencode',
      'cursor',
      'copilot',
      'qwen',
      'kimi',
      'goose'
    ] as const) {
      await expect(probe(ready(provider))).resolves.toMatchObject({
        providerId: provider,
        state: 'verified'
      });
    }
    expect(spawned).toEqual([
      {
        path: 'C:\\tools\\codex.cmd',
        args: ['app-server', '--stdio'],
        timeout: 10_000
      },
      { path: 'C:\\tools\\gemini.cmd', args: ['--acp'], timeout: 30_000 },
      { path: 'C:\\tools\\opencode.cmd', args: ['acp'], timeout: 30_000 },
      { path: 'C:\\tools\\cursor.cmd', args: ['acp'], timeout: 30_000 },
      {
        path: 'C:\\tools\\copilot.cmd',
        args: ['--acp', '--stdio'],
        timeout: 30_000
      },
      { path: 'C:\\tools\\qwen.cmd', args: ['--acp'], timeout: 30_000 },
      { path: 'C:\\tools\\kimi.cmd', args: ['acp'], timeout: 30_000 },
      { path: 'C:\\tools\\goose.cmd', args: ['acp'], timeout: 30_000 }
    ]);
  });

  it('checks Claude through the pinned SDK adapter without starting a prompt', async () => {
    const probeClaude = vi.fn(async () => ({
      providerId: 'claude' as const,
      integration: 'claude_agent_sdk' as const,
      checkedAt: '2026-08-26T12:00:00.000Z',
      version: '2.1.239',
      state: 'verified' as const,
      capabilities: {
        newSession: true,
        resumeSession: true,
        history: true,
        streaming: true,
        toolActivity: true,
        approvals: true,
        cancellation: true,
        usage: true,
        attachments: true
      },
      issue: null
    }));
    const createTransport = vi.fn();
    const probe = createLocalStructuredProviderProbe({
      platform: 'linux',
      env: { PATH: '/usr/bin' },
      createTransport,
      probeClaude
    });

    await probe({
      ...ready('claude'),
      executablePath: '/usr/local/bin/claude'
    });

    expect(probeClaude).toHaveBeenCalledWith(expect.objectContaining({
      executablePath: '/usr/local/bin/claude',
      version: '2.1.239'
    }));
    expect(createTransport).not.toHaveBeenCalled();
  });
});
