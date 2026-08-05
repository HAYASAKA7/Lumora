import { describe, expect, it } from 'vitest';

import {
  RemoteHostKeyObservationSchema,
  RemoteHelperInstallDetailsSchema,
  RemoteDiscoverySnapshotSchema,
  RemoteProviderPreferencesSchema,
  RemoteTargetConnectionDetailsSchema,
  RemoteTargetListSchema,
  RemoteTargetSummarySchema
} from './contracts';

const target = {
  id: 'e0954cdd-f3d7-4093-ac24-d74ff6cc9830',
  kind: 'remote',
  displayName: 'Linux server',
  platform: 'linux',
  architecture: 'x64',
  connectionState: 'ready',
  helperVersion: null,
  protocolVersion: null,
  capabilities: [],
  lastConnectedAt: '2026-08-04T10:00:00.000Z',
  lastScannedAt: null
} as const;

const profile = {
  executionTargetId: target.id,
  displayName: 'Linux server',
  route: 'direct',
  host: 'linux.internal',
  port: 22,
  username: 'builder',
  sshConfigHost: null,
  authentication: { method: 'password' },
  verifiedHostFingerprint: 'SHA256:57qsnZ7C9rC8S3dftMDSqdHcpZ+PZfNclRBfXZXp0mM',
  createdAt: '2026-08-04T09:00:00.000Z',
  updatedAt: '2026-08-04T09:00:00.000Z'
} as const;

describe('remote target API contracts', () => {
  it('accepts bounded non-secret target summaries and connection details', () => {
    const summary = RemoteTargetSummarySchema.parse({ target, profile });
    expect(RemoteTargetListSchema.parse([summary])).toEqual([summary]);
    expect(RemoteTargetConnectionDetailsSchema.parse({
      ...summary,
      homeDirectory: '/home/builder',
      defaultShell: '/bin/bash'
    })).toMatchObject({ homeDirectory: '/home/builder' });
    expect(RemoteHelperInstallDetailsSchema.parse({
      status: 'missing',
      helperVersion: '0.1.0',
      installLocation: '/home/builder/.local/share/lumora/helper/lumora-helper',
      requiresConfirmation: true
    })).toMatchObject({ status: 'missing', requiresConfirmation: true });
  });

  it('rejects local targets, unknown fields, and malformed observations', () => {
    expect(() => RemoteTargetSummarySchema.parse({
      target: { ...target, id: 'local', kind: 'local' },
      profile
    })).toThrow();
    expect(() => RemoteHostKeyObservationSchema.parse({
      executionTargetId: target.id,
      fingerprint: 'not-a-fingerprint',
      privateKey: 'leak'
    })).toThrow();
  });

  it('rejects unconfirmed or unbounded helper-install details', () => {
    expect(() => RemoteHelperInstallDetailsSchema.parse({
      status: 'missing',
      helperVersion: '0.1.0',
      installLocation: '/tmp/lumora-helper',
      requiresConfirmation: false
    })).toThrow();
    expect(() => RemoteHelperInstallDetailsSchema.parse({
      status: 'missing',
      helperVersion: '0.1.0',
      installLocation: '/tmp/lumora-helper',
      requiresConfirmation: true,
      command: 'hidden-command'
    })).toThrow();
  });

  it('validates target-scoped provider preferences and discovery snapshots', () => {
    expect(RemoteProviderPreferencesSchema.parse({
      enabledProviders: ['opencode', 'codex']
    })).toEqual({ enabledProviders: ['codex', 'opencode'] });
    expect(RemoteProviderPreferencesSchema.safeParse({
      enabledProviders: []
    }).success).toBe(false);

    const snapshot = {
      executionTargetId: target.id,
      scannedAt: '2026-08-05T04:03:02.000Z',
      environment: {
        checkedAt: '2026-08-05T04:03:02.000Z',
        node: {
          state: 'ready', executablePath: '/usr/bin/node', version: 'v24'
        },
        npm: { state: 'not_found', executablePath: null, version: null }
      },
      providers: {
        scannedAt: '2026-08-05T04:03:02.000Z',
        providers: [{
          provider: 'codex', displayName: 'Codex', state: 'ready',
          executablePath: '/usr/bin/codex', version: 'codex 1.2.3', issue: null
        }]
      }
    } as const;
    expect(RemoteDiscoverySnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(RemoteDiscoverySnapshotSchema.safeParse({
      ...snapshot,
      environmentVariables: { PATH: '/private' }
    }).success).toBe(false);
  });
});
