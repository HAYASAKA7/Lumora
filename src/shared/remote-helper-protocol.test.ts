import { describe, expect, it } from 'vitest';

import {
  REMOTE_HELPER_PROTOCOL_VERSION,
  RemoteHelperDiscoveryResponseSchema,
  RemoteHelperHandshakeResponseSchema,
  RemoteHelperRequestSchema,
  RemoteHelperResponseSchema,
  RemoteHelperSessionScanResponseSchema
} from './remote-helper-protocol';

const request = {
  protocolVersion: REMOTE_HELPER_PROTOCOL_VERSION,
  kind: 'request',
  generation: 4,
  requestId: 'request-4',
  operation: 'handshake',
  payload: {}
} as const;

describe('remote helper protocol contracts', () => {
  it('accepts bounded, paginated session metadata without transcript contents', () => {
    const sessionRequest = {
      ...request,
      operation: 'session-scan',
      payload: { provider: 'codex', cursor: null, limit: 50 }
    } as const;
    expect(RemoteHelperRequestSchema.parse(sessionRequest)).toEqual(sessionRequest);
    expect(RemoteHelperRequestSchema.safeParse({
      ...sessionRequest,
      payload: { ...sessionRequest.payload, provider: 'aider' }
    }).success).toBe(false);
    expect(RemoteHelperRequestSchema.safeParse({
      ...sessionRequest,
      payload: { ...sessionRequest.payload, limit: 501 }
    }).success).toBe(false);

    const response = {
      protocolVersion: 1,
      kind: 'response',
      generation: 4,
      requestId: 'request-4',
      operation: 'session-scan',
      ok: true,
      result: {
        provider: 'codex',
        scannedAt: '2026-08-09T04:03:02.000Z',
        status: 'ready',
        sessions: [{
          nativeId: 'thread-1',
          workspacePath: '/home/lumora/project',
          title: 'Fix the remote catalog',
          createdAt: '2026-08-08T04:03:02.000Z',
          updatedAt: '2026-08-09T04:03:02.000Z',
          lifetimeTokens: 42,
          sourceKey: 'thread-1'
        }],
        invalidCount: 0,
        nextCursor: '1'
      }
    } as const;
    expect(RemoteHelperSessionScanResponseSchema.parse(response)).toEqual(response);
    expect(RemoteHelperSessionScanResponseSchema.parse({
      ...response,
      result: {
        provider: 'opencode',
        scannedAt: '2026-08-09T04:03:02.000Z',
        status: 'unavailable',
        sessions: [],
        invalidCount: 0,
        nextCursor: null
      }
    })).toMatchObject({ result: { status: 'unavailable' } });
    expect(RemoteHelperSessionScanResponseSchema.parse({
      ...response,
      result: {
        provider: 'claude',
        scannedAt: '2026-08-09T04:03:02.000Z',
        status: 'failed',
        sessions: [],
        invalidCount: 0,
        nextCursor: null
      }
    })).toMatchObject({ result: { status: 'failed' } });
    expect(JSON.stringify(response)).not.toContain('transcript');
    expect(RemoteHelperSessionScanResponseSchema.safeParse({
      ...response,
      result: {
        ...response.result,
        sessions: [{ ...response.result.sessions[0], raw: 'private prompt' }]
      }
    }).success).toBe(false);
  });

  it('accepts a bounded discovery scan and its normalized result', () => {
    const discoveryRequest = {
      ...request,
      operation: 'discovery-scan',
      payload: { enabledProviders: ['codex', 'opencode'] }
    } as const;
    expect(RemoteHelperRequestSchema.parse(discoveryRequest)).toEqual(
      discoveryRequest
    );
    expect(RemoteHelperRequestSchema.safeParse({
      ...discoveryRequest,
      payload: { enabledProviders: ['codex', 'codex'] }
    }).success).toBe(false);
    expect(RemoteHelperRequestSchema.safeParse({
      ...discoveryRequest,
      payload: { enabledProviders: ['unknown'] }
    }).success).toBe(false);

    const response = {
      protocolVersion: 1,
      kind: 'response',
      generation: 4,
      requestId: 'request-4',
      operation: 'discovery-scan',
      ok: true,
      result: {
        checkedAt: '2026-08-05T04:03:02.000Z',
        node: {
          state: 'ready', executablePath: '/usr/bin/node', version: 'v24.0.0'
        },
        npm: {
          state: 'not_found', executablePath: null, version: null
        },
        providers: [{
          provider: 'codex', state: 'probe_failed',
          executablePath: '/usr/bin/codex', version: null
        }]
      }
    } as const;
    expect(RemoteHelperDiscoveryResponseSchema.parse(response)).toEqual(response);
  });

  it('accepts strict named requests and rejects unknown operations or payload fields', () => {
    expect(RemoteHelperRequestSchema.parse(request)).toEqual(request);
    expect(RemoteHelperRequestSchema.safeParse({
      ...request,
      operation: 'exec',
      payload: { command: 'whoami' }
    }).success).toBe(false);
    expect(RemoteHelperRequestSchema.safeParse({
      ...request,
      payload: { extra: true }
    }).success).toBe(false);
  });

  it('validates a normalized, capability-bounded handshake', () => {
    const response = {
      protocolVersion: 1,
      kind: 'response',
      generation: 4,
      requestId: 'request-4',
      operation: 'handshake',
      ok: true,
      result: {
        helperVersion: '0.1.0',
        protocolVersion: 1,
        platform: 'linux',
        architecture: 'arm64',
        homeDirectory: '/home/lumora',
        defaultShell: '/bin/bash',
        capabilities: ['system-info']
      }
    } as const;

    expect(RemoteHelperHandshakeResponseSchema.parse(response)).toEqual(response);
    expect(RemoteHelperResponseSchema.safeParse({
      ...response,
      result: { ...response.result, capabilities: ['arbitrary-exec'] }
    }).success).toBe(false);
  });

  it('bounds request identity and connection generations', () => {
    expect(RemoteHelperRequestSchema.safeParse({
      ...request,
      generation: -1
    }).success).toBe(false);
    expect(RemoteHelperRequestSchema.safeParse({
      ...request,
      requestId: 'x'.repeat(81)
    }).success).toBe(false);
  });
});
