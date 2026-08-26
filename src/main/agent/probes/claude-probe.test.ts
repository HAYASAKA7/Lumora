import { describe, expect, it } from 'vitest';

import { probeClaudeStructuredProvider } from './claude-probe';

describe('Claude structured capability probe', () => {
  it('verifies a compatible installed Claude Code without sending a query', async () => {
    let loadCount = 0;
    const report = await probeClaudeStructuredProvider({
      executablePath: 'C:\\tools\\claude.exe',
      version: '2.1.239 (Claude Code)',
      loadSdk: async () => {
        loadCount += 1;
        return {
          sdkVersion: '0.3.246',
          claudeCodeVersion: '2.1.246',
          queryAvailable: true
        };
      },
      now: () => new Date('2026-08-26T12:00:00.000Z')
    });

    expect(loadCount).toBe(1);
    expect(report).toMatchObject({
      providerId: 'claude',
      integration: 'claude_agent_sdk',
      state: 'verified',
      version: '2.1.239 (Claude Code)',
      capabilities: { attachments: false }
    });
  });

  it('rejects a runtime newer than the SDK compatibility line', async () => {
    const report = await probeClaudeStructuredProvider({
      executablePath: '/usr/local/bin/claude',
      version: '2.2.1 (Claude Code)',
      loadSdk: async () => ({
        sdkVersion: '0.3.246',
        claudeCodeVersion: '2.1.246',
        queryAvailable: true
      })
    });

    expect(report).toMatchObject({
      state: 'incompatible',
      issue: { code: 'STRUCTURED_VERSION_UNSUPPORTED' }
    });
  });
});
