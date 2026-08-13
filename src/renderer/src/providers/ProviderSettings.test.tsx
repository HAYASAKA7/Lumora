import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  GeneralSettings,
  ProviderLaunchConfig,
  ProviderScanResult,
  ProviderUpdateCheckResult
} from '../../../shared/contracts';
import { DEFAULT_GENERAL_SETTINGS } from '../../../shared/contracts';
import { ProviderSettings } from './ProviderSettings';

const scan: ProviderScanResult = {
  scannedAt: '2026-07-11T04:00:00.000Z',
  providers: [
    {
      provider: 'codex', displayName: 'Codex', state: 'ready',
      executablePath: 'C:\\tools\\codex.cmd', version: '1.0.0', issue: null
    },
    {
      provider: 'claude', displayName: 'Claude Code', state: 'ready',
      executablePath: 'C:\\tools\\claude.cmd', version: '2.0.0', issue: null
    }
  ]
};

const defaults: ProviderLaunchConfig[] = [
  { provider: 'codex', command: null },
  { provider: 'claude', command: null }
];

const availableUpdates: ProviderUpdateCheckResult = {
  checkedAt: '2026-07-17T04:01:00.000Z',
  providers: [
    {
      provider: 'codex', displayName: 'Codex', state: 'update_available',
      installedVersion: '1.0.0', latestVersion: '1.1.0', issue: null
    },
    {
      provider: 'claude', displayName: 'Claude Code', state: 'up_to_date',
      installedVersion: '2.0.0', latestVersion: '2.0.0', issue: null
    }
  ]
};

function setLumora(overrides: Record<string, unknown> = {}) {
  const value = {
    getProviderLaunchConfigs: vi.fn().mockResolvedValue(defaults),
    saveProviderLaunchConfig: vi.fn().mockResolvedValue(defaults),
    checkProviderUpdates: vi.fn().mockResolvedValue(availableUpdates),
    installProvider: vi.fn().mockResolvedValue({
      provider: 'gemini',
      completedAt: '2026-07-17T04:02:00.000Z',
      installation: {
        provider: 'gemini',
        displayName: 'Gemini CLI',
        state: 'ready',
        executablePath: 'C:\\tools\\gemini.cmd',
        version: '1.0.0',
        issue: null
      }
    }),
    openProviderInstallGuide: vi.fn().mockResolvedValue(undefined),
    updateProvider: vi.fn().mockResolvedValue({
      provider: 'codex',
      completedAt: '2026-07-17T04:02:00.000Z',
      installation: scan.providers[0]
    }),
    ...overrides
  };
  Object.defineProperty(window, 'lumora', {
    configurable: true,
    value
  });
  return value;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('ProviderSettings', () => {
  it('stages enabled providers, prevents an empty selection, and saves explicitly', async () => {
    setLumora();
    const onSaveEnabledProviders = vi.fn().mockResolvedValue(true);
    const settings: GeneralSettings = {
      ...DEFAULT_GENERAL_SETTINGS,
      enabledProviders: ['codex', 'claude']
    };
    render(
      <ProviderSettings
        generalSettings={settings}
        onRefresh={vi.fn()}
        onSaveEnabledProviders={onSaveEnabledProviders}
        status={{ state: 'ready', scan }}
      />
    );

    expect(screen.getAllByRole('checkbox')).toHaveLength(13);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Use Claude Code' }));
    expect(
      screen.getByRole('checkbox', { name: 'Use Codex' })
    ).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save provider selection' }));

    await waitFor(() =>
      expect(onSaveEnabledProviders).toHaveBeenCalledWith(['codex'])
    );
  });

  it('does not check releases automatically when that preference is disabled', async () => {
    const lumora = setLumora();
    render(
      <ProviderSettings
        generalSettings={{
          ...DEFAULT_GENERAL_SETTINGS,
          checkProviderUpdatesAutomatically: false
        }}
        onRefresh={vi.fn()}
        status={{ state: 'ready', scan }}
      />
    );

    expect(await screen.findAllByText('Updates not checked')).toHaveLength(2);
    expect(lumora.checkProviderUpdates).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('button', { name: 'Check for provider updates' })
    );
    expect(await screen.findByText('Update available · 1.1.0')).toBeVisible();
    expect(lumora.checkProviderUpdates).toHaveBeenCalledOnce();
  });

  it('shows saved-session capability for complete and launch-only providers', async () => {
    setLumora();
    const capabilityScan: ProviderScanResult = {
      ...scan,
      providers: [
        {
          provider: 'gemini',
          displayName: 'Gemini CLI',
          state: 'ready',
          executablePath: 'C:\\tools\\gemini.cmd',
          version: '1.0.0',
          issue: null
        },
        {
          provider: 'aider',
          displayName: 'Aider',
          state: 'not_found',
          executablePath: null,
          version: null,
          issue: {
            code: 'PROVIDER_NOT_FOUND',
            message: 'Aider was not found.',
            recovery: 'Install Aider, then refresh.',
            retryable: true
          }
        }
      ]
    };

    render(
      <ProviderSettings
        onRefresh={vi.fn()}
        status={{ state: 'ready', scan: capabilityScan }}
      />
    );

    const geminiCard = screen
      .getByRole('heading', { name: 'Gemini CLI' })
      .closest('article');
    const aiderCard = screen
      .getByRole('heading', { name: 'Aider' })
      .closest('article');
    expect(geminiCard).not.toBeNull();
    expect(aiderCard).not.toBeNull();
    expect(within(geminiCard!).getByText('Saved sessions: Full session support'))
      .toBeInTheDocument();
    expect(within(aiderCard!).getByText('Saved sessions: Launch only'))
      .toBeInTheDocument();
  });

  it('saves and resets a provider start command', async () => {
    const saveProviderLaunchConfig = vi.fn(
      async (input: { provider: 'codex' | 'claude'; command: string | null }) =>
        defaults.map((config) =>
          config.provider === input.provider ? { ...config, command: input.command } : config
        )
    );
    setLumora({ saveProviderLaunchConfig });

    render(
      <ProviderSettings
        onRefresh={vi.fn()}
        status={{ state: 'ready', scan }}
      />
    );

    expect(
      screen.queryByRole('heading', { name: 'Developer tools' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Provider installations' })
    ).toBeInTheDocument();
    const input = await screen.findByLabelText('Codex start command');
    expect(
      screen.getAllByText(/Provider layer override/).length
    ).toBeGreaterThan(0);
    fireEvent.change(input, { target: { value: 'codexp' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'Save Codex start command' })
    );

    await waitFor(() => {
      expect(saveProviderLaunchConfig).toHaveBeenCalledWith({
        provider: 'codex',
        command: 'codexp'
      });
      expect(
        screen.getByRole('button', { name: 'Save Codex start command' })
      ).toBeEnabled();
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Reset Codex start command' })
    );
    await waitFor(() =>
      expect(saveProviderLaunchConfig).toHaveBeenLastCalledWith({
        provider: 'codex',
        command: null
      })
    );
  });

  it('checks releases on mount and shows current and available states', async () => {
    const lumora = setLumora();

    render(
      <ProviderSettings onRefresh={vi.fn()} status={{ state: 'ready', scan }} />
    );

    expect(await screen.findByText('Update available · 1.1.0')).toBeVisible();
    expect(screen.getByText('Up to date · 2.0.0')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Update Codex with npm to 1.1.0' })
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Update Codex with npm to 1.1.0' })
    ).toHaveTextContent('Update with npm to 1.1.0');
    expect(screen.queryByRole('button', { name: /Update Claude/ })).toBeNull();
    expect(lumora.checkProviderUpdates).toHaveBeenCalledOnce();
  });

  it('keeps failed release checks non-blocking and retryable', async () => {
    setLumora({
      checkProviderUpdates: vi.fn().mockResolvedValue({
        ...availableUpdates,
        providers: [
          {
            provider: 'codex', displayName: 'Codex', state: 'unavailable',
            installedVersion: '1.0.0', latestVersion: null,
            issue: {
              code: 'PROVIDER_RELEASE_UNAVAILABLE',
              message: 'Codex latest version could not be checked.',
              recovery: 'Check the network connection, then refresh.',
              retryable: true
            }
          },
          availableUpdates.providers[1]
        ]
      })
    });

    render(
      <ProviderSettings onRefresh={vi.fn()} status={{ state: 'ready', scan }} />
    );

    expect(await screen.findByText('Latest version unavailable')).toBeVisible();
    expect(screen.getByText('Check the network connection, then refresh.')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Update Codex/ })).toBeNull();
    expect(screen.getByLabelText('Codex start command')).toBeEnabled();
  });

  it('updates one provider, refreshes discovery, and checks again', async () => {
    let completeUpdate!: () => void;
    const updateProvider = vi.fn(
      async () => new Promise((resolve) => {
        completeUpdate = () => resolve({
          provider: 'codex',
          completedAt: '2026-07-17T04:02:00.000Z',
          installation: scan.providers[0]
        });
      })
    );
    const checkProviderUpdates = vi.fn()
      .mockResolvedValueOnce(availableUpdates)
      .mockResolvedValueOnce({
        ...availableUpdates,
        checkedAt: '2026-07-17T04:03:00.000Z',
        providers: availableUpdates.providers.map((provider) =>
          provider.provider === 'codex'
            ? { ...provider, state: 'up_to_date' as const, installedVersion: '1.1.0' }
            : provider
        )
      });
    setLumora({ updateProvider, checkProviderUpdates });
    const onRefresh = vi.fn();
    render(
      <ProviderSettings onRefresh={onRefresh} status={{ state: 'ready', scan }} />
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Update Codex with npm to 1.1.0' })
    );
    expect(updateProvider).not.toHaveBeenCalled();
    expect(screen.getByText(
      'Lumora will run a global npm update. If Codex was installed another way, this may create a separate installation.'
    )).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(updateProvider).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('button', { name: 'Update Codex with npm to 1.1.0' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirm update Codex with npm' }));
    expect(screen.getByRole('button', { name: 'Updating Codex' })).toBeDisabled();
    expect(screen.getByLabelText('Claude Code start command')).toBeEnabled();
    completeUpdate();

    await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
    await waitFor(() => expect(checkProviderUpdates).toHaveBeenCalledTimes(2));
    expect(updateProvider).toHaveBeenCalledWith('codex');
  });

  it('shows update failures and keeps discovery refresh separate from release checks', async () => {
    const checkProviderUpdates = vi.fn().mockResolvedValue(availableUpdates);
    setLumora({
      checkProviderUpdates,
      updateProvider: vi.fn().mockRejectedValue(new Error('failed'))
    });
    const onRefresh = vi.fn();
    render(
      <ProviderSettings onRefresh={onRefresh} status={{ state: 'ready', scan }} />
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Update Codex with npm to 1.1.0' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirm update Codex with npm' }));
    expect(
      await screen.findByText('Codex could not be updated. Run codex update manually or try again.')
    ).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(checkProviderUpdates).toHaveBeenCalledOnce();
    fireEvent.click(
      screen.getByRole('button', { name: 'Check for provider updates' })
    );
    await waitFor(() => expect(checkProviderUpdates).toHaveBeenCalledTimes(2));
  });

  it('confirms allowlisted installs and opens guides for other providers', async () => {
    const wideScan: ProviderScanResult = {
      ...scan,
      providers: [
        ...scan.providers,
        {
          provider: 'gemini',
          displayName: 'Gemini CLI',
          state: 'not_found',
          executablePath: null,
          version: null,
          issue: {
            code: 'PROVIDER_NOT_FOUND',
            message: 'Gemini CLI was not found on PATH.',
            recovery: 'Install Gemini CLI or add it to PATH, then refresh.',
            retryable: true
          }
        },
        {
          provider: 'aider',
          displayName: 'Aider',
          state: 'not_found',
          executablePath: null,
          version: null,
          issue: {
            code: 'PROVIDER_NOT_FOUND',
            message: 'Aider was not found on PATH.',
            recovery: 'Install Aider or add it to PATH, then refresh.',
            retryable: true
          }
        }
      ]
    };
    const lumora = setLumora();
    const onRefresh = vi.fn();
    render(
      <ProviderSettings
        onRefresh={onRefresh}
        status={{ state: 'ready', scan: wideScan }}
      />
    );

    expect(
      screen.getByRole('heading', { name: 'Installed providers' })
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Available providers' })
    ).toBeVisible();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Install Gemini CLI' })
    );
    expect(
      screen.getByText('Install Gemini CLI globally with npm?')
    ).toBeVisible();
    expect(lumora.installProvider).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm install Gemini CLI' })
    );
    await waitFor(() =>
      expect(lumora.installProvider).toHaveBeenCalledWith('gemini')
    );
    await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());

    fireEvent.click(
      screen.getByRole('button', { name: 'Open Aider installation guide' })
    );
    expect(lumora.openProviderInstallGuide).toHaveBeenCalledWith('aider');
    expect(screen.getByLabelText('Gemini CLI start command')).toHaveValue('');
  });

  it('tracks simultaneous provider installs independently', async () => {
    const geminiInstall = deferred<Awaited<ReturnType<typeof window.lumora.installProvider>>>();
    const crushInstall = deferred<Awaited<ReturnType<typeof window.lumora.installProvider>>>();
    const installProvider = vi.fn((provider: string) =>
      provider === 'gemini' ? geminiInstall.promise : crushInstall.promise
    );
    setLumora({ installProvider });
    const missing = (provider: 'gemini' | 'crush', displayName: string) => ({
      provider,
      displayName,
      state: 'not_found' as const,
      executablePath: null,
      version: null,
      issue: {
        code: 'PROVIDER_NOT_FOUND' as const,
        message: `${displayName} is missing.`,
        recovery: `Install ${displayName}.`,
        retryable: true
      }
    });

    render(
      <ProviderSettings
        onRefresh={vi.fn()}
        status={{
          state: 'ready',
          scan: {
            scannedAt: scan.scannedAt,
            providers: [
              missing('gemini', 'Gemini CLI'),
              missing('crush', 'Crush')
            ]
          }
        }}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Install Gemini CLI' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm install Gemini CLI' }));
    fireEvent.click(screen.getByRole('button', { name: 'Install Crush' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm install Crush' }));

    expect(screen.getByRole('button', { name: 'Install Gemini CLI' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Install Crush' })).toBeDisabled();
  });
});
