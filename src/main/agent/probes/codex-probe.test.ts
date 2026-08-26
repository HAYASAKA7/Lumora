import { describe, expect, it, vi } from 'vitest';

import type { LineJsonRpcTransport } from '../transport/line-json-rpc';
import { probeCodexStructuredProvider } from './codex-probe';

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
    notify: vi.fn(async (method: string, params: unknown = null) => {
      calls.push({ method, params });
    }),
    onNotification: () => () => undefined,
    close: vi.fn(async () => undefined)
  };
}

describe('Codex structured capability probe', () => {
  it('initializes without creating a thread and closes the transport', async () => {
    const transport = fakeTransport({
      userAgent: 'codex-cli/0.149.1',
      platformFamily: 'windows',
      platformOs: 'windows'
    });

    const report = await probeCodexStructuredProvider({
      executablePath: 'C:\\tools\\codex.cmd',
      version: 'codex-cli 0.149.1',
      createTransport: async () => transport,
      now: () => new Date('2026-08-26T12:00:00.000Z')
    });

    expect(report).toMatchObject({
      providerId: 'codex',
      integration: 'codex_app_server',
      state: 'verified',
      version: 'codex-cli 0.149.1'
    });
    expect(transport.calls.map(({ method }) => method)).toEqual([
      'initialize',
      'initialized'
    ]);
    expect(transport.calls.some(({ method }) => method === 'thread/start'))
      .toBe(false);
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it('returns a bounded failed report for an invalid handshake', async () => {
    const transport = fakeTransport({ userAgent: 42 });
    const report = await probeCodexStructuredProvider({
      executablePath: '/usr/bin/codex',
      version: 'codex-cli 0.149.1',
      createTransport: async () => transport
    });

    expect(report).toMatchObject({
      state: 'failed',
      capabilities: null,
      issue: { code: 'STRUCTURED_PROBE_FAILED' }
    });
    expect(transport.close).toHaveBeenCalledOnce();
  });
});
