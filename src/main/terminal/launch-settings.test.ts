import { describe, expect, it } from 'vitest';

import type {
  LaunchSettingsLayer,
  TerminalProfile
} from '../../shared/contracts';
import { resolveLaunchSettings } from './launch-settings';

const workspaceId = 'a'.repeat(64);
const sessionId = 'b'.repeat(64);
const recommendedId = 'c'.repeat(64);
const sessionProfileId = 'd'.repeat(64);

function profile(
  id: string,
  overrides: Partial<TerminalProfile> = {}
): TerminalProfile {
  return {
    id,
    kind: 'detected',
    name: id === recommendedId ? 'Recommended shell' : 'Session shell',
    shellFamily: 'pwsh',
    executablePath: `C:\\Shells\\${id.slice(0, 4)}.exe`,
    args: [],
    available: true,
    recommended: id === recommendedId,
    ...overrides
  };
}

function layer(
  scope: LaunchSettingsLayer['scope'],
  targetId: string,
  settings: LaunchSettingsLayer['settings']
): LaunchSettingsLayer {
  return {
    scope,
    targetId,
    settings,
    updatedAt: '2026-07-13T00:00:00.000Z'
  } as LaunchSettingsLayer;
}

describe('resolveLaunchSettings', () => {
  it('applies all layers in order and records shadowed values', () => {
    const result = resolveLaunchSettings({
      provider: 'codex',
      workspaceId,
      sessionId,
      requestedTerminalProfileId: null,
      profiles: [profile(recommendedId), profile(sessionProfileId)],
      layers: [
        layer('session', sessionId, {
          terminalProfileId: sessionProfileId,
          providerCommands: { codex: 'session-codex' }
        }),
        layer('global', 'global', {
          terminalProfileId: null,
          providerCommands: { codex: 'global-codex', claude: 'global-claude' }
        }),
        layer('workspace', workspaceId, {
          providerCommands: { codex: 'workspace-codex' }
        }),
        layer('provider', 'codex', {
          providerCommands: { codex: 'provider-codex' }
        })
      ]
    });

    expect(result.command).toBe('session-codex');
    expect(result.profile?.id).toBe(sessionProfileId);
    expect(result.configuration.map((field) => field.winningSource.scope))
      .toEqual(['session', 'session']);
    expect(result.configuration[0].shadowed.map((item) => item.value)).toEqual([
      null,
      'global-codex',
      'provider-codex',
      'workspace-codex'
    ]);
  });

  it('filters providers and treats explicit null as a winning command', () => {
    const result = resolveLaunchSettings({
      provider: 'claude',
      workspaceId,
      sessionId: null,
      requestedTerminalProfileId: null,
      profiles: [profile(recommendedId)],
      layers: [
        layer('global', 'global', {
          providerCommands: { codex: 'codexp', claude: 'claude-dev' }
        }),
        layer('provider', 'claude', {
          providerCommands: { claude: null }
        })
      ]
    });

    expect(result.command).toBeNull();
    expect(result.configuration[0]).toMatchObject({
      winningSource: { scope: 'provider', targetId: 'claude' },
      shadowed: [
        { value: null, source: { scope: 'default' } },
        { value: 'claude-dev', source: { scope: 'global' } }
      ]
    });
  });

  it('falls back from an unavailable saved profile with a warning', () => {
    const missingId = 'e'.repeat(64);
    const result = resolveLaunchSettings({
      provider: 'codex',
      workspaceId,
      sessionId: null,
      requestedTerminalProfileId: null,
      profiles: [
        profile(recommendedId),
        profile(missingId, { available: false, recommended: false })
      ],
      layers: [
        layer('workspace', workspaceId, { terminalProfileId: missingId })
      ]
    });

    expect(result.profile?.id).toBe(recommendedId);
    expect(result.configuration[1].winningSource.scope).toBe('default');
    expect(result.warnings).toEqual([
      'The workspace terminal profile is unavailable; using the lower-precedence value.'
    ]);
  });

  it('uses a concrete launch override and rejects an unavailable one', () => {
    const available = resolveLaunchSettings({
      provider: 'codex',
      workspaceId,
      sessionId: null,
      requestedTerminalProfileId: sessionProfileId,
      profiles: [profile(recommendedId), profile(sessionProfileId)],
      layers: []
    });
    expect(available.profile?.id).toBe(sessionProfileId);
    expect(available.configuration[1].winningSource.scope).toBe('launch');

    const unavailable = resolveLaunchSettings({
      provider: 'codex',
      workspaceId,
      sessionId: null,
      requestedTerminalProfileId: 'f'.repeat(64),
      profiles: [profile(recommendedId)],
      layers: []
    });
    expect(unavailable.profile).toBeNull();
    expect(unavailable.configuration[1].winningSource.scope).toBe('launch');
  });

  it('returns no profile when none are available', () => {
    const result = resolveLaunchSettings({
      provider: 'codex',
      workspaceId,
      sessionId: null,
      requestedTerminalProfileId: null,
      profiles: [],
      layers: []
    });
    expect(result.profile).toBeNull();
    expect(result.configuration[1].value).toBeNull();
  });
});
