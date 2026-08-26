import { describe, expect, it, vi } from 'vitest';

import type { LineJsonRpcTransport } from '../transport/line-json-rpc';
import { probeGeminiStructuredProvider } from './gemini-probe';

function fakeTransport(result: unknown): LineJsonRpcTransport & {
  calls: Array<{ method: string; params: unknown }>;
} {
  const calls: Array<{ method: string; params: unknown }> = [];
  return {
    calls,
    request: vi.fn(async (method: string, params: unknown) => {
      calls.push({ method, params });
      return result;
    }),
    notify: vi.fn(async () => undefined),
    onNotification: () => () => undefined,
    onExit: () => () => undefined,
    close: vi.fn(async () => undefined)
  };
}

describe('Gemini structured capability probe', () => {
  it('reads ACP capabilities without authenticating or creating a session', async () => {
    const transport = fakeTransport({
      protocolVersion: 1,
      agentInfo: { name: 'gemini-cli', title: 'Gemini CLI', version: '0.44.1' },
      authMethods: [{ id: 'oauth-personal', name: 'Login with Google' }],
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: {
          image: true,
          audio: true,
          embeddedContext: true
        },
        mcpCapabilities: { http: true, sse: true },
        sessionCapabilities: { list: {} }
      }
    });

    const report = await probeGeminiStructuredProvider({
      executablePath: '/usr/bin/gemini',
      version: '0.44.1',
      createTransport: async () => transport,
      now: () => new Date('2026-08-26T12:00:00.000Z')
    });

    expect(report).toMatchObject({
      providerId: 'gemini',
      integration: 'gemini_acp',
      state: 'verified',
      capabilities: {
        resumeSession: true,
        attachments: false,
        usage: false
      }
    });
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]).toMatchObject({ method: 'initialize' });
    expect(transport.calls.some(({ method }) =>
      method === 'authenticate' || method === 'session/new'
    )).toBe(false);
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it('rejects unsupported ACP protocol versions safely', async () => {
    const transport = fakeTransport({
      protocolVersion: 2,
      agentCapabilities: {}
    });
    const report = await probeGeminiStructuredProvider({
      executablePath: '/usr/bin/gemini',
      version: '0.44.1',
      createTransport: async () => transport
    });

    expect(report).toMatchObject({
      state: 'incompatible',
      capabilities: null,
      issue: { code: 'STRUCTURED_VERSION_UNSUPPORTED' }
    });
  });
});
