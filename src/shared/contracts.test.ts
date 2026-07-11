import { describe, expect, it } from 'vitest';

import {
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
