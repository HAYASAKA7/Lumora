import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  LaunchSettingsLayer,
  SessionSummary,
  TerminalProfile,
  WorkspaceSummary
} from '../../../shared/contracts';
import { LaunchSettingsPanel } from './LaunchSettingsPanel';
import { renderWithLocalization } from '../test/render-with-localization';

const render = renderWithLocalization;

const workspace: WorkspaceSummary = {
  id: 'a'.repeat(64),
  displayName: 'Lumora',
  canonicalPath: 'D:\\Projects\\Lumora',
  available: true,
  origin: 'manual',
  sessionCount: 1,
  providerCounts: { codex: 1, claude: 0 },
  lastActivityAt: '2026-07-13T00:00:00.000Z'
};
const session: SessionSummary = {
  id: 'b'.repeat(64),
  nativeId: 'native-session',
  provider: 'codex',
  workspaceId: workspace.id,
  title: 'Fix settings',
  createdAt: '2026-07-13T00:00:00.000Z',
  updatedAt: '2026-07-13T00:00:00.000Z',
  lifetimeTokens: null,
  lifecycle: 'saved',
  sourceFreshness: 'current'
};
const profile: TerminalProfile = {
  id: 'c'.repeat(64),
  kind: 'detected',
  name: 'PowerShell 7',
  shellFamily: 'pwsh',
  executablePath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
  args: [],
  available: true,
  recommended: true
};
const workspaceLayer: LaunchSettingsLayer = {
  scope: 'workspace',
  targetId: workspace.id,
  settings: {
    terminalProfileId: null,
    providerCommands: { codex: 'workspace-codex' }
  },
  updatedAt: '2026-07-13T00:00:00.000Z'
};

function choose(label: string, option: string): void {
  fireEvent.click(screen.getByRole('button', { name: label }));
  fireEvent.click(screen.getByRole('option', { name: option }));
}

describe('LaunchSettingsPanel', () => {
  it('hydrates and saves a workspace layer without conflating inherit and null', async () => {
    const saveLaunchSettingsLayer = vi.fn(async () => [workspaceLayer]);
    Object.defineProperty(window, 'lumora', {
      configurable: true,
      value: {
        getLaunchSettingsLayers: vi.fn().mockResolvedValue([workspaceLayer]),
        saveLaunchSettingsLayer
      }
    });

    render(
      <LaunchSettingsPanel
        profiles={[profile]}
        sessions={[session]}
        workspaces={[workspace]}
      />
    );

    await screen.findByText('Launch defaults');
    choose('Settings scope', 'Workspace');
    await waitFor(() =>
      expect(screen.getByLabelText('Scope target')).toHaveTextContent(workspace.displayName)
    );
    expect(screen.getByLabelText('Default terminal profile')).toHaveTextContent(
      'Automatic recommended'
    );
    expect(screen.getByLabelText('Codex command mode')).toHaveTextContent('Custom command');
    expect(screen.getByLabelText('Codex command')).toHaveValue(
      'workspace-codex'
    );

    choose('Claude Code command mode', 'Use detected CLI');
    fireEvent.click(
      screen.getByRole('button', { name: 'Save launch settings' })
    );

    await waitFor(() =>
      expect(saveLaunchSettingsLayer).toHaveBeenCalledWith({
        scope: 'workspace',
        targetId: workspace.id,
        settings: {
          terminalProfileId: null,
          providerCommands: {
            codex: 'workspace-codex',
            claude: null
          }
        }
      })
    );
  });

  it('limits session commands to its provider and resets the layer', async () => {
    const saveLaunchSettingsLayer = vi.fn(async () => []);
    Object.defineProperty(window, 'lumora', {
      configurable: true,
      value: {
        getLaunchSettingsLayers: vi.fn().mockResolvedValue([]),
        saveLaunchSettingsLayer
      }
    });
    render(
      <LaunchSettingsPanel
        profiles={[profile]}
        sessions={[session]}
        workspaces={[workspace]}
      />
    );

    await screen.findByText('Launch defaults');
    choose('Settings scope', 'Session');
    await screen.findByLabelText('Codex command mode');
    expect(
      screen.queryByLabelText('Claude Code command mode')
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset layer' }));

    await waitFor(() =>
      expect(saveLaunchSettingsLayer).toHaveBeenCalledWith({
        scope: 'session',
        targetId: session.id,
        settings: {}
      })
    );
  });

  it('offers launch-command settings for every registered provider', async () => {
    Object.defineProperty(window, 'lumora', {
      configurable: true,
      value: {
        getLaunchSettingsLayers: vi.fn().mockResolvedValue([]),
        saveLaunchSettingsLayer: vi.fn().mockResolvedValue([])
      }
    });
    render(
      <LaunchSettingsPanel
        profiles={[profile]}
        sessions={[session]}
        workspaces={[workspace]}
      />
    );

    await screen.findByText('Launch defaults');
    choose('Settings scope', 'Provider');

    fireEvent.click(screen.getByRole('button', { name: 'Scope target' }));
    expect(
      screen.getByRole('option', { name: 'Gemini CLI' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'Gemini CLI' }));
    expect(
      await screen.findByLabelText('Gemini CLI command mode')
    ).toBeInTheDocument();
  });

  it('excludes disabled providers from provider targets and command settings', async () => {
    Object.defineProperty(window, 'lumora', {
      configurable: true,
      value: {
        getLaunchSettingsLayers: vi.fn().mockResolvedValue([]),
        saveLaunchSettingsLayer: vi.fn().mockResolvedValue([])
      }
    });
    render(
      <LaunchSettingsPanel
        enabledProviders={['codex']}
        profiles={[profile]}
        sessions={[session]}
        workspaces={[workspace]}
      />
    );

    await screen.findByText('Launch defaults');
    expect(screen.getByLabelText('Codex command mode')).toBeInTheDocument();
    expect(
      screen.queryByLabelText('Claude Code command mode')
    ).not.toBeInTheDocument();

    choose('Settings scope', 'Provider');
    fireEvent.click(screen.getByRole('button', { name: 'Scope target' }));
    expect(screen.getByRole('option', { name: 'Codex' })).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: 'Claude Code' })
    ).not.toBeInTheDocument();
  });

  it('preserves disabled provider commands when saving an enabled launch layer', async () => {
    const hiddenCommandLayer: LaunchSettingsLayer = {
      scope: 'global',
      targetId: 'global',
      settings: {
        providerCommands: {
          claude: 'claude-with-profile'
        }
      },
      updatedAt: '2026-07-13T00:00:00.000Z'
    };
    const saveLaunchSettingsLayer = vi.fn().mockResolvedValue([
      hiddenCommandLayer
    ]);
    Object.defineProperty(window, 'lumora', {
      configurable: true,
      value: {
        getLaunchSettingsLayers: vi.fn().mockResolvedValue([
          hiddenCommandLayer
        ]),
        saveLaunchSettingsLayer
      }
    });
    render(
      <LaunchSettingsPanel
        enabledProviders={['codex']}
        profiles={[profile]}
        sessions={[session]}
        workspaces={[workspace]}
      />
    );

    await screen.findByText('Editing saved global layer.');
    choose('Default terminal profile', 'Automatic recommended');
    fireEvent.click(
      screen.getByRole('button', { name: 'Save launch settings' })
    );

    await waitFor(() =>
      expect(saveLaunchSettingsLayer).toHaveBeenCalledWith({
        scope: 'global',
        targetId: 'global',
        settings: {
          terminalProfileId: null,
          providerCommands: {
            claude: 'claude-with-profile'
          }
        }
      })
    );
  });
});
