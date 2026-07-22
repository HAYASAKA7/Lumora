import { describe, expect, it } from 'vitest';

import {
  CatalogQuerySchema,
  CatalogSnapshotSchema,
  ClipboardTextSchema,
  ClipboardWriteResultSchema,
  CustomTerminalProfileInputSchema,
  DEFAULT_GENERAL_SETTINGS,
  DEFAULT_KEYBOARD_SETTINGS,
  DeveloperEnvironmentScanResultSchema,
  GeneralSettingsSchema,
  IPC_CHANNELS,
  KeyboardSettingsSchema,
  KeyboardShortcutChordSchema,
  LaunchSettingsLayerInputSchema,
  LaunchSettingsLayerSchema,
  LaunchPrepareRequestSchema,
  LaunchPreviewSchema,
  ProviderIdSchema,
  ProviderInstallationSchema,
  ProviderScanResultSchema,
  ProviderUpdateCheckResultSchema,
  ProviderUpdateRequestSchema,
  ProviderUpdateResultSchema,
  RuntimeAttachmentSchema,
  RuntimeEventSchema,
  RuntimeSummarySchema,
  RuntimeWriteRequestSchema,
  SystemInfoSchema,
  WorkspaceTrustDecisionListSchema,
  WorkspaceTrustDecisionSchema,
  WorkspaceTrustGrantRequestSchema,
  WorkspaceTrustRevokeRequestSchema
} from './contracts';
import * as contracts from './contracts';

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

describe('ProviderIdSchema', () => {
  it('accepts every provider in the wider lifecycle catalog', () => {
    expect(
      [
        'codex',
        'claude',
        'gemini',
        'antigravity',
        'opencode',
        'cursor',
        'copilot',
        'qwen',
        'amp',
        'crush',
        'goose',
        'aider'
      ].map((provider) => ProviderIdSchema.parse(provider))
    ).toHaveLength(12);
  });

  it('rejects provider identifiers that Lumora did not ship', () => {
    expect(ProviderIdSchema.safeParse('unknown-agent').success).toBe(false);
  });
});

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

describe('developer environment contracts', () => {
  const environmentScan = {
    checkedAt: '2026-07-17T01:00:00.000Z',
    node: {
      state: 'ready',
      executablePath: 'C:\\Program Files\\nodejs\\node.EXE',
      version: 'v24.18.0'
    },
    npm: {
      state: 'not_found',
      executablePath: null,
      version: null
    }
  } as const;

  it('accepts consistent ready and missing tool states', () => {
    expect(DeveloperEnvironmentScanResultSchema.parse(environmentScan)).toEqual(
      environmentScan
    );
  });

  it('rejects inconsistent tool states and malformed envelopes', () => {
    expect(
      DeveloperEnvironmentScanResultSchema.safeParse({
        ...environmentScan,
        node: { state: 'ready', executablePath: null, version: 'v24.18.0' }
      }).success
    ).toBe(false);
    expect(
      DeveloperEnvironmentScanResultSchema.safeParse({
        ...environmentScan,
        npm: {
          state: 'probe_failed',
          executablePath: '/usr/local/bin/npm',
          version: 'untrusted version'
        }
      }).success
    ).toBe(false);
    expect(
      DeveloperEnvironmentScanResultSchema.safeParse({
        ...environmentScan,
        checkedAt: 'today'
      }).success
    ).toBe(false);
  });

  it('defines narrow environment channels', () => {
    expect(IPC_CHANNELS.environmentScan).toBe('lumora:environment:scan');
    expect(IPC_CHANNELS.nodeDownloadOpen).toBe(
      'lumora:environment:node-download:open'
    );
  });
});

describe('IPC_CHANNELS', () => {
  it('defines the one-time startup presentation claim channel', () => {
    expect(IPC_CHANNELS.startupPresentationClaim).toBe(
      'lumora:system:startup-presentation:claim'
    );
  });

  it('names every channel inside the Lumora namespace', () => {
    expect(Object.values(IPC_CHANNELS)).not.toHaveLength(0);

    for (const channel of Object.values(IPC_CHANNELS)) {
      expect(channel).toMatch(/^lumora:/);
    }
  });
});

describe('clipboard contracts', () => {
  it('bounds plain clipboard text and validates accepted writes', () => {
    expect(ClipboardTextSchema.parse('hello')).toBe('hello');
    expect(ClipboardTextSchema.parse('')).toBe('');
    expect(
      ClipboardTextSchema.safeParse('x'.repeat(4_194_304)).success
    ).toBe(true);
    expect(
      ClipboardTextSchema.safeParse('x'.repeat(4_194_305)).success
    ).toBe(false);
    expect(ClipboardWriteResultSchema.parse({ accepted: true })).toEqual({
      accepted: true
    });
    expect(
      ClipboardWriteResultSchema.safeParse({ accepted: true, extra: true })
        .success
    ).toBe(false);
    expect(
      ClipboardWriteResultSchema.safeParse({ accepted: false }).success
    ).toBe(false);
  });

  it('defines only namespaced clipboard channels', () => {
    expect(IPC_CHANNELS.clipboardTextRead).toBe(
      'lumora:clipboard:text:read'
    );
    expect(IPC_CHANNELS.clipboardTextWrite).toBe(
      'lumora:clipboard:text:write'
    );
  });
});

describe('provider discovery contracts', () => {
  it('accepts complete ready and missing provider states', () => {
    expect(ProviderInstallationSchema.parse(readyCodex)).toEqual(readyCodex);
    expect(ProviderInstallationSchema.parse(missingClaude)).toEqual(missingClaude);
  });

  it('accepts a provider scan with an ISO timestamp', () => {
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
        provider: 'unknown-agent'
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

  it('accepts strict provider update availability and completion results', () => {
    const check = {
      checkedAt: '2026-07-17T02:00:00.000Z',
      providers: [
        {
          provider: 'codex',
          displayName: 'Codex',
          state: 'update_available',
          installedVersion: '1.2.3',
          latestVersion: '1.3.0',
          issue: null
        },
        {
          provider: 'claude',
          displayName: 'Claude Code',
          state: 'unavailable',
          installedVersion: null,
          latestVersion: null,
          issue: {
            code: 'PROVIDER_NOT_READY',
            message: 'Claude Code is not ready.',
            recovery: 'Install or repair Claude Code, then refresh.',
            retryable: true
          }
        }
      ]
    } as const;
    const result = {
      provider: 'codex',
      completedAt: '2026-07-17T02:01:00.000Z',
      installation: readyCodex
    } as const;

    expect(ProviderUpdateCheckResultSchema.parse(check)).toEqual(check);
    expect(ProviderUpdateRequestSchema.parse({ provider: 'claude' })).toEqual({
      provider: 'claude'
    });
    expect(ProviderUpdateResultSchema.parse(result)).toEqual(result);
  });

  it('rejects inconsistent or over-broad provider update data', () => {
    expect(
      ProviderUpdateCheckResultSchema.safeParse({
        checkedAt: '2026-07-17T02:00:00.000Z',
        providers: [
          {
            provider: 'codex',
            displayName: 'Codex',
            state: 'up_to_date',
            installedVersion: '1.2.3',
            latestVersion: null,
            issue: null
          }
        ]
      }).success
    ).toBe(false);
    expect(
      ProviderUpdateRequestSchema.safeParse({
        provider: 'codex',
        executablePath: '/tmp/codex'
      }).success
    ).toBe(false);
    expect(
      ProviderUpdateResultSchema.safeParse({
        provider: 'gemini',
        completedAt: 'not-a-date',
        installation: { ...readyCodex, provider: 'gemini' }
      }).success
    ).toBe(false);
  });

  it('defines narrow provider update channels', () => {
    expect(IPC_CHANNELS.providerUpdatesCheck).toBe(
      'lumora:providers:updates:check'
    );
    expect(IPC_CHANNELS.providerUpdateRun).toBe(
      'lumora:providers:update:run'
    );
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
    lifetimeTokens: 128_450,
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
    providerFacets: [{ provider: 'codex', sessionCount: 1 }],
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
    expect(
      CatalogSnapshotSchema.safeParse({
        ...snapshot,
        diagnostics: [{
          ...snapshot.diagnostics[0],
          code: 'CATALOG_PROVIDER_INCOMPATIBLE'
        }]
      }).success
    ).toBe(true);
  });

  it('accepts nullable safe lifetime token totals and rejects invalid totals', () => {
    expect(
      CatalogSnapshotSchema.safeParse({
        ...snapshot,
        sessions: [{ ...session, lifetimeTokens: null }]
      }).success
    ).toBe(true);
    for (const lifetimeTokens of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        CatalogSnapshotSchema.safeParse({
          ...snapshot,
          sessions: [{ ...session, lifetimeTokens }]
        }).success
      ).toBe(false);
    }
  });

  it('accepts dynamic session providers, partial counts, and nonzero facets', () => {
    const dynamic = {
      ...snapshot,
      workspaces: [
        {
          ...workspace,
          sessionCount: 3,
          providerCounts: { codex: 1, gemini: 2 }
        }
      ],
      sessions: [{ ...session, provider: 'gemini' }],
      providerStatus: [
        snapshot.providerStatus[0],
        {
          provider: 'gemini',
          state: 'ready',
          discoveredCount: 2,
          unchangedCount: 0,
          invalidCount: 0
        }
      ],
      providerFacets: [
        { provider: 'codex', sessionCount: 1 },
        { provider: 'gemini', sessionCount: 2 }
      ]
    } as const;

    expect(CatalogSnapshotSchema.parse(dynamic)).toEqual(dynamic);
    expect(
      CatalogSnapshotSchema.safeParse({
        ...dynamic,
        workspaces: [
          { ...dynamic.workspaces[0], providerCounts: { unknown: 1 } }
        ]
      }).success
    ).toBe(false);
    expect(
      CatalogSnapshotSchema.safeParse({
        ...dynamic,
        providerFacets: [{ provider: 'gemini', sessionCount: 0 }]
      }).success
    ).toBe(false);
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
    ).toBe(true);
  });

  it('defines narrowed catalog IPC channels', () => {
    expect(IPC_CHANNELS.catalogGet).toBe('lumora:catalog:get');
    expect(IPC_CHANNELS.catalogRefresh).toBe('lumora:catalog:refresh');
    expect(IPC_CHANNELS.workspaceChoose).toBe('lumora:workspace:choose');
  });
});

describe('managed terminal contracts', () => {
  const profile = {
    id: 'c'.repeat(64),
    kind: 'detected',
    name: 'PowerShell 7',
    shellFamily: 'pwsh',
    executablePath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    args: ['-NoLogo'],
    available: true,
    recommended: true
  } as const;

  it('validates workspace trust decisions and requests', () => {
    const workspaceId = 'a'.repeat(64);
    const decision = {
      workspaceId,
      canonicalPath: 'D:\\Projects\\AI\\Lumora',
      trustedAt: '2026-07-13T08:00:00.000Z'
    } as const;

    expect(WorkspaceTrustDecisionSchema.parse(decision)).toEqual(decision);
    expect(WorkspaceTrustDecisionListSchema.parse([decision])).toEqual([
      decision
    ]);
    expect(
      WorkspaceTrustGrantRequestSchema.parse({
        launchToken: '0198f8b6-18f3-7ca0-9f0f-123456789abc'
      })
    ).toEqual({ launchToken: '0198f8b6-18f3-7ca0-9f0f-123456789abc' });
    expect(
      WorkspaceTrustRevokeRequestSchema.parse({ workspaceId })
    ).toEqual({ workspaceId });

    expect(
      WorkspaceTrustDecisionSchema.safeParse({
        ...decision,
        canonicalPath: ''
      }).success
    ).toBe(false);
    expect(
      WorkspaceTrustDecisionSchema.safeParse({
        ...decision,
        trustedAt: 'recently'
      }).success
    ).toBe(false);
    expect(
      WorkspaceTrustGrantRequestSchema.safeParse({ launchToken: 'not-a-uuid' })
        .success
    ).toBe(false);
    expect(
      WorkspaceTrustRevokeRequestSchema.safeParse({ workspaceId: '../escape' })
        .success
    ).toBe(false);

    expect(IPC_CHANNELS.workspaceTrustGet).toBe(
      'lumora:terminal:workspace-trust:get'
    );
    expect(IPC_CHANNELS.workspaceTrustGrant).toBe(
      'lumora:terminal:workspace-trust:grant'
    );
    expect(IPC_CHANNELS.workspaceTrustRevoke).toBe(
      'lumora:terminal:workspace-trust:revoke'
    );
  });

  it('accepts single-line provider commands and rejects multiline input', () => {
    const schema = (
      contracts as unknown as {
        ProviderLaunchConfigInputSchema: {
          parse(value: unknown): unknown;
          safeParse(value: unknown): { success: boolean };
        };
      }
    ).ProviderLaunchConfigInputSchema;

    expect(schema.parse({ provider: 'codex', command: 'codexp' })).toEqual({
      provider: 'codex',
      command: 'codexp'
    });
    expect(
      schema.safeParse({ provider: 'codex', command: "codex\n--dangerous" })
        .success
    ).toBe(false);
    expect(schema.parse({ provider: 'claude', command: null })).toEqual({
      provider: 'claude',
      command: null
    });
  });

  it('types launch setting layers and enforces provider ownership', () => {
    const settings = {
      terminalProfileId: null,
      providerCommands: { codex: 'codexp', claude: null }
    } as const;

    expect(
      LaunchSettingsLayerSchema.parse({
        scope: 'global',
        targetId: 'global',
        settings,
        updatedAt: '2026-07-13T00:00:00.000Z'
      })
    ).toMatchObject({ scope: 'global', settings });
    expect(
      LaunchSettingsLayerInputSchema.safeParse({
        scope: 'provider',
        targetId: 'codex',
        settings: { providerCommands: { claude: 'claude-dev' } }
      }).success
    ).toBe(false);
    expect(
      LaunchSettingsLayerInputSchema.parse({
        scope: 'workspace',
        targetId: 'a'.repeat(64),
        settings: {}
      })
    ).toMatchObject({ scope: 'workspace', settings: {} });
  });

  it('accepts bounded custom terminal profile input', () => {
    expect(
      CustomTerminalProfileInputSchema.parse({
        name: 'Development shell',
        shellFamily: 'zsh',
        executablePath: '/bin/zsh',
        args: ['-l']
      })
    ).toEqual({
      name: 'Development shell',
      shellFamily: 'zsh',
      executablePath: '/bin/zsh',
      args: ['-l']
    });

    expect(
      CustomTerminalProfileInputSchema.safeParse({
        name: 'Too many arguments',
        shellFamily: 'other',
        executablePath: '/bin/custom',
        args: Array.from({ length: 17 }, () => 'x')
      }).success
    ).toBe(false);
  });

  it('accepts typed launch preparation and preview payloads', () => {
    const request = {
      strategy: 'new',
      workspaceId: 'a'.repeat(64),
      provider: 'claude',
      terminalProfileId: profile.id,
      cols: 120,
      rows: 36
    } as const;
    const preview = {
      launchToken: '0198f8b6-18f3-7ca0-9f0f-123456789abc',
      launchHash: 'd'.repeat(64),
      strategy: 'new',
      sessionId: null,
      provider: 'claude',
      executablePath: 'C:\\Users\\dev\\bin\\claude.exe',
      command: null,
      args: [],
      workingDirectory: 'D:\\Projects\\Lumora',
      workspaceTrusted: false,
      environmentNames: ['SHELL'],
      terminalProfile: profile,
      configuration: [
        {
          field: 'providerCommand',
          value: null,
          winningSource: { scope: 'default', targetId: null },
          shadowed: [],
          mergeStrategy: 'replace',
          warnings: [],
          sensitive: false
        },
        {
          field: 'terminalProfile',
          value: profile.id,
          winningSource: { scope: 'launch', targetId: null },
          shadowed: [],
          mergeStrategy: 'replace',
          warnings: [],
          sensitive: false
        }
      ],
      warnings: [],
      createdAt: '2026-07-11T04:00:00.000Z',
      expiresAt: '2026-07-11T04:05:00.000Z'
    } as const;

    expect(LaunchPrepareRequestSchema.parse(request)).toEqual(request);
    expect(LaunchPreviewSchema.parse(preview)).toEqual(preview);
    const { workspaceTrusted: _workspaceTrusted, ...previewWithoutTrust } =
      preview;
    expect(LaunchPreviewSchema.safeParse(previewWithoutTrust).success).toBe(
      false
    );
    const resumeRequest = {
      strategy: 'resume',
      sessionId: 'c'.repeat(64),
      terminalProfileId: profile.id,
      cols: 120,
      rows: 36
    } as const;
    expect(LaunchPrepareRequestSchema.parse(resumeRequest)).toEqual(
      resumeRequest
    );
    expect(
      LaunchPrepareRequestSchema.parse({
        ...request,
        terminalProfileId: null
      }).terminalProfileId
    ).toBeNull();
    expect(
      LaunchPrepareRequestSchema.safeParse({
        ...resumeRequest,
        provider: 'codex',
        workspaceId: 'a'.repeat(64)
      }).success
    ).toBe(false);
    expect(
      LaunchPreviewSchema.parse({
        ...preview,
        strategy: 'resume',
        sessionId: resumeRequest.sessionId,
        args: ['--resume', 'native-session']
      })
    ).toMatchObject({
      strategy: 'resume',
      sessionId: resumeRequest.sessionId
    });
    expect(
      LaunchPrepareRequestSchema.safeParse({ ...request, cols: 5 }).success
    ).toBe(false);
    expect(
      LaunchPreviewSchema.safeParse({
        ...preview,
        environment: { API_KEY: 'secret' }
      }).success
    ).toBe(false);
  });

  it('bounds runtime input and output events', () => {
    const runtimeId = '0198f8b6-18f3-7ca0-9f0f-123456789abc';
    expect(
      RuntimeWriteRequestSchema.parse({ runtimeId, data: '\u0003' })
    ).toEqual({ runtimeId, data: '\u0003' });
    expect(
      RuntimeWriteRequestSchema.safeParse({
        runtimeId,
        data: 'x'.repeat(65_537)
      }).success
    ).toBe(false);
    expect(
      RuntimeEventSchema.parse({
        type: 'output',
        runtimeId,
        sequence: 4,
        data: 'ready'
      })
    ).toEqual({ type: 'output', runtimeId, sequence: 4, data: 'ready' });
    expect(
      RuntimeEventSchema.safeParse({
        type: 'output',
        runtimeId,
        sequence: 5,
        data: 'x'.repeat(65_537)
      }).success
    ).toBe(false);

    const runtime = RuntimeSummarySchema.parse({
      id: runtimeId,
      displayName: 'Repository cleanup',
      strategy: 'new',
      sessionId: null,
      nativeSessionId: null,
      reconciliationState: 'pending',
      provider: 'codex',
      workspaceId: 'a'.repeat(64),
      terminalProfileId: 'b'.repeat(64),
      launchHash: 'c'.repeat(64),
      state: 'running',
      pid: 123,
      createdAt: '2026-07-13T01:00:00.000Z',
      startedAt: '2026-07-13T01:00:01.000Z',
      endedAt: null,
      exitCode: null,
      errorCode: null
    });
    expect(runtime.displayName).toBe('Repository cleanup');
    expect(
      RuntimeAttachmentSchema.parse({
        runtime,
        snapshot: 'ready',
        outputSequence: 3
      })
    ).toMatchObject({ snapshot: 'ready', outputSequence: 3 });
  });

  it('validates durable runtime launch identity combinations', () => {
    const runtimeBase = {
      id: '0198f8b6-18f3-7ca0-9f0f-123456789abc',
      displayName: 'Repository cleanup',
      provider: 'codex',
      workspaceId: 'a'.repeat(64),
      terminalProfileId: 'b'.repeat(64),
      launchHash: 'c'.repeat(64),
      state: 'completed',
      pid: null,
      createdAt: '2026-07-11T04:00:00.000Z',
      startedAt: '2026-07-11T04:00:01.000Z',
      endedAt: '2026-07-11T04:05:00.000Z',
      exitCode: 0,
      errorCode: null
    } as const;

    expect(RuntimeSummarySchema.safeParse({
      ...runtimeBase,
      displayName: '   ',
      strategy: 'new',
      sessionId: null,
      nativeSessionId: null,
      reconciliationState: 'pending'
    }).success).toBe(false);

    expect(RuntimeSummarySchema.parse({
      ...runtimeBase,
      strategy: 'new',
      sessionId: null,
      nativeSessionId: null,
      reconciliationState: 'pending'
    })).toMatchObject({ strategy: 'new', reconciliationState: 'pending' });
    expect(RuntimeSummarySchema.safeParse({
      ...runtimeBase,
      strategy: 'resume',
      sessionId: 'd'.repeat(64),
      nativeSessionId: 'native-thread-1',
      reconciliationState: 'not_required'
    }).success).toBe(true);
    expect(RuntimeSummarySchema.safeParse({
      ...runtimeBase,
      strategy: 'resume',
      sessionId: null,
      nativeSessionId: 'native-thread-1',
      reconciliationState: 'not_required'
    }).success).toBe(true);
    expect(RuntimeSummarySchema.safeParse({
      ...runtimeBase,
      strategy: 'resume',
      sessionId: 'd'.repeat(64),
      nativeSessionId: null,
      reconciliationState: 'not_required'
    }).success).toBe(false);
    expect(RuntimeSummarySchema.safeParse({
      ...runtimeBase,
      strategy: 'new',
      sessionId: 'd'.repeat(64),
      nativeSessionId: null,
      reconciliationState: 'linked'
    }).success).toBe(false);
    expect(RuntimeSummarySchema.safeParse({
      ...runtimeBase,
      strategy: 'new',
      sessionId: 'd'.repeat(64),
      nativeSessionId: 'native-thread-1',
      reconciliationState: 'linked'
    }).success).toBe(true);
    expect(RuntimeSummarySchema.safeParse({
      ...runtimeBase,
      strategy: 'new',
      sessionId: null,
      nativeSessionId: null,
      reconciliationState: 'linked'
    }).success).toBe(false);
    expect(RuntimeSummarySchema.safeParse({
      ...runtimeBase,
      strategy: 'new',
      sessionId: 'd'.repeat(64),
      nativeSessionId: 'native-thread-1',
      reconciliationState: 'ambiguous'
    }).success).toBe(false);
    expect(RuntimeSummarySchema.safeParse({
      ...runtimeBase,
      strategy: 'resume',
      sessionId: 'd'.repeat(64),
      nativeSessionId: 'native-thread-1',
      reconciliationState: 'linked'
    }).success).toBe(false);
  });

  it('defines only namespaced terminal channels', () => {
    expect(IPC_CHANNELS.terminalProfilesGet).toBe(
      'lumora:terminal:profiles:get'
    );
    expect(IPC_CHANNELS.runtimeEvent).toBe('lumora:terminal:runtime:event');
  });

  it('validates versioned keyboard settings with a real modified key', () => {
    expect(KeyboardSettingsSchema.parse(DEFAULT_KEYBOARD_SETTINGS)).toEqual({
      version: 1,
      terminalSwitcher: {
        code: 'Tab',
        control: true,
        alt: false,
        shift: false,
        meta: false
      },
      openTerminals: expect.objectContaining({ code: 'KeyT', control: true }),
      toggleSidebar: expect.objectContaining({
        code: 'KeyL',
        control: true,
        shift: true
      }),
      openHome: expect.objectContaining({ code: 'Digit1', control: true }),
      openWorkspaces: expect.objectContaining({ code: 'Digit2', control: true }),
      openSessions: expect.objectContaining({ code: 'Digit3', control: true }),
      openProfiles: expect.objectContaining({ code: 'Digit4', control: true }),
      openSettings: expect.objectContaining({ code: 'Digit5', control: true }),
      openSettingsAlias: expect.objectContaining({ code: 'Comma', control: true })
    });
    expect(KeyboardSettingsSchema.parse({
      version: 1,
      terminalSwitcher: {
        code: 'KeyK',
        control: true,
        alt: false,
        shift: true,
        meta: false
      }
    })).toEqual({
      ...DEFAULT_KEYBOARD_SETTINGS,
      terminalSwitcher: expect.objectContaining({ code: 'KeyK', shift: true })
    });
    expect(KeyboardShortcutChordSchema.safeParse({
      code: 'KeyK',
      control: true,
      alt: false,
      shift: true,
      meta: false
    }).success).toBe(true);
    expect(KeyboardShortcutChordSchema.safeParse({
      code: 'KeyK',
      control: false,
      alt: false,
      shift: true,
      meta: false
    }).success).toBe(false);
    expect(KeyboardShortcutChordSchema.safeParse({
      code: 'ControlLeft',
      control: true,
      alt: false,
      shift: false,
      meta: false
    }).success).toBe(false);
  });

  it('validates versioned general settings', () => {
    expect(GeneralSettingsSchema.parse(DEFAULT_GENERAL_SETTINGS)).toEqual({
      version: 1,
      showInformationalNotices: true
    });
    expect(GeneralSettingsSchema.safeParse({
      version: 1,
      showInformationalNotices: 'no'
    }).success).toBe(false);
    expect(GeneralSettingsSchema.safeParse({
      version: 1
    }).success).toBe(false);
  });
});
