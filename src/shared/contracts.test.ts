import { describe, expect, it } from 'vitest';

import {
  CatalogQuerySchema,
  CatalogSnapshotSchema,
  IPC_CHANNELS,
  ProviderInstallationSchema,
  ProviderScanResultSchema,
  SystemInfoSchema
} from './contracts';

const readyCodex = {
  provider: 'codex',
  displayName: 'Codex',
  state: 'ready',
  executablePath: '/usr/local/bin/codex',
  version: 'codex-cli 1.2.3',
  issue: null
} as const;

const missingClaude = {
  provider: 'claude',
  displayName: 'Claude Code',
  state: 'not_found',
  executablePath: null,
  version: null,
  issue: {
    code: 'PROVIDER_NOT_FOUND',
    message: 'Claude Code was not found.',
    recovery: 'Install Claude Code or add it to PATH, then refresh.',
    retryable: true
  }
} as const;

describe('SystemInfoSchema', () => {
  it('accepts and preserves a complete supported system payload', () => {
    const payload = {
      platform: 'win32',
      arch: 'x64',
      appVersion: '0.1.0'
    } as const;

    expect(SystemInfoSchema.parse(payload)).toEqual(payload);
  });

  it('rejects an unsupported operating system', () => {
    expect(
      SystemInfoSchema.safeParse({
        platform: 'freebsd',
        arch: 'x64',
        appVersion: '0.1.0'
      }).success
    ).toBe(false);
  });

  it('rejects unexpected fields instead of silently stripping them', () => {
    expect(
      SystemInfoSchema.safeParse({
        platform: 'linux',
        arch: 'arm64',
        appVersion: '0.1.0',
        secret: 'must-not-cross-ipc'
      }).success
    ).toBe(false);
  });
});

describe('IPC_CHANNELS', () => {
  it('names every channel inside the Lumora namespace', () => {
    expect(Object.values(IPC_CHANNELS)).not.toHaveLength(0);

    for (const channel of Object.values(IPC_CHANNELS)) {
      expect(channel).toMatch(/^lumora:/);
    }
  });
});

describe('provider discovery contracts', () => {
  it('accepts complete ready and missing provider states', () => {
    expect(ProviderInstallationSchema.parse(readyCodex)).toEqual(readyCodex);
    expect(ProviderInstallationSchema.parse(missingClaude)).toEqual(missingClaude);
  });

  it('accepts a complete two-provider scan with an ISO timestamp', () => {
    const scan = {
      scannedAt: '2026-07-11T00:00:00.000Z',
      providers: [readyCodex, missingClaude]
    } as const;

    expect(ProviderScanResultSchema.parse(scan)).toEqual(scan);
  });

  it('rejects inconsistent state fields and unexpected data', () => {
    expect(
      ProviderInstallationSchema.safeParse({
        ...readyCodex,
        version: null
      }).success
    ).toBe(false);

    expect(
      ProviderInstallationSchema.safeParse({
        ...missingClaude,
        executablePath: '/tmp/claude'
      }).success
    ).toBe(false);

    expect(
      ProviderInstallationSchema.safeParse({
        ...readyCodex,
        provider: 'gemini'
      }).success
    ).toBe(false);

    expect(
      ProviderInstallationSchema.safeParse({
        ...readyCodex,
        environment: { TOKEN: 'must-not-cross-ipc' }
      }).success
    ).toBe(false);
  });

  it('rejects incomplete issues and malformed scan envelopes', () => {
    expect(
      ProviderInstallationSchema.safeParse({
        ...missingClaude,
        issue: {
          code: 'PROVIDER_NOT_FOUND',
          message: 'Claude Code was not found.'
        }
      }).success
    ).toBe(false);

    expect(
      ProviderScanResultSchema.safeParse({
        scannedAt: 'yesterday',
        providers: [readyCodex]
      }).success
    ).toBe(false);
  });

  it('defines a dedicated provider scan channel', () => {
    expect(IPC_CHANNELS.providerScan).toBe('lumora:providers:scan');
  });
});

describe('catalog contracts', () => {
  const workspaceId = 'a'.repeat(64);
  const sessionId = 'b'.repeat(64);
  const workspace = {
    id: workspaceId,
    displayName: 'lumora',
    canonicalPath: 'D:\\Projects\\AI\\Lumora',
    available: true,
    origin: 'manual',
    sessionCount: 1,
    providerCounts: { codex: 1, claude: 0 },
    lastActivityAt: '2026-07-11T03:00:00.000Z'
  } as const;
  const session = {
    id: sessionId,
    nativeId: '0198f8b6-18f3-7ca0-9f0f-123456789abc',
    provider: 'codex',
    workspaceId,
    title: 'Catalog implementation',
    createdAt: '2026-07-11T02:00:00.000Z',
    updatedAt: '2026-07-11T03:00:00.000Z',
    lifecycle: 'saved',
    sourceFreshness: 'current'
  } as const;
  const snapshot = {
    refreshedAt: '2026-07-11T03:01:00.000Z',
    workspaces: [workspace],
    sessions: [session],
    providerStatus: [
      {
        provider: 'codex',
        state: 'ready',
        discoveredCount: 1,
        unchangedCount: 0,
        invalidCount: 0
      },
      {
        provider: 'claude',
        state: 'unavailable',
        discoveredCount: 0,
        unchangedCount: 0,
        invalidCount: 0
      }
    ],
    diagnostics: [
      {
        code: 'CATALOG_PROVIDER_UNAVAILABLE',
        provider: 'claude',
        affectedCount: 0,
        message: 'Claude Code is not ready.',
        recovery: 'Install or repair Claude Code, then refresh.',
        retryable: true,
        scannedAt: '2026-07-11T03:01:00.000Z'
      }
    ]
  } as const;

  it('accepts a complete normalized catalog snapshot', () => {
    expect(CatalogSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });

  it('rejects source paths, transcript data, and unknown states', () => {
    expect(
      CatalogSnapshotSchema.safeParse({
        ...snapshot,
        sessions: [
          {
            ...session,
            sourcePath: 'C:\\Users\\dev\\.codex\\sessions\\secret.jsonl'
          }
        ]
      }).success
    ).toBe(false);

    expect(
      CatalogSnapshotSchema.safeParse({
        ...snapshot,
        sessions: [{ ...session, transcript: ['private prompt'] }]
      }).success
    ).toBe(false);

    expect(
      CatalogSnapshotSchema.safeParse({
        ...snapshot,
        sessions: [{ ...session, lifecycle: 'unknown' }]
      }).success
    ).toBe(false);
  });

  it('rejects malformed IDs, timestamps, and diagnostic codes', () => {
    expect(
      CatalogSnapshotSchema.safeParse({
        ...snapshot,
        workspaces: [{ ...workspace, id: '../workspace' }]
      }).success
    ).toBe(false);

    expect(
      CatalogSnapshotSchema.safeParse({
        ...snapshot,
        sessions: [{ ...session, updatedAt: 'recently' }]
      }).success
    ).toBe(false);

    expect(
      CatalogSnapshotSchema.safeParse({
        ...snapshot,
        diagnostics: [
          { ...snapshot.diagnostics[0], code: 'RAW_SQLITE_ERROR' }
        ]
      }).success
    ).toBe(false);
  });

  it('bounds and validates catalog queries', () => {
    expect(
      CatalogQuerySchema.parse({ text: '  catalog  ', provider: 'claude' })
    ).toEqual({ text: 'catalog', provider: 'claude' });
    expect(
      CatalogQuerySchema.safeParse({ text: 'x'.repeat(121), provider: null })
        .success
    ).toBe(false);
    expect(
      CatalogQuerySchema.safeParse({ text: '', provider: 'gemini' }).success
    ).toBe(false);
  });

  it('defines narrowed catalog IPC channels', () => {
    expect(IPC_CHANNELS.catalogGet).toBe('lumora:catalog:get');
    expect(IPC_CHANNELS.catalogRefresh).toBe('lumora:catalog:refresh');
    expect(IPC_CHANNELS.workspaceChoose).toBe('lumora:workspace:choose');
  });
});
