import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  ProviderLaunchConfig,
  ProviderScanResult,
  ProviderUpdateCheckResult
} from '../../../shared/contracts';
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

describe('ProviderSettings', () => {
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

    await waitFor(() =>
      expect(saveProviderLaunchConfig).toHaveBeenCalledWith({
        provider: 'codex',
        command: 'codexp'
      })
    );

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
      screen.getByRole('button', { name: 'Update Codex to 1.1.0' })
    ).toBeVisible();
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
      await screen.findByRole('button', { name: 'Update Codex to 1.1.0' })
    );
    expect(screen.getByRole('button', { name: 'Updating Codex' })).toBeDisabled();
    expect(screen.getByLabelText('Claude Code start command')).toBeEnabled();
    completeUpdate();

    await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
    await waitFor(() => expect(checkProviderUpdates).toHaveBeenCalledTimes(2));
    expect(updateProvider).toHaveBeenCalledWith('codex');
  });

  it('shows update failures and refreshes discovery plus releases together', async () => {
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
      await screen.findByRole('button', { name: 'Update Codex to 1.1.0' })
    );
    expect(
      await screen.findByText('Codex could not be updated. Run codex update manually or try again.')
    ).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onRefresh).toHaveBeenCalledOnce();
    await waitFor(() => expect(checkProviderUpdates).toHaveBeenCalledTimes(2));
  });
});
