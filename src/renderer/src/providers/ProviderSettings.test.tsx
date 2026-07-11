import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ProviderLaunchConfig, ProviderScanResult } from '../../../shared/contracts';
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

describe('ProviderSettings', () => {
  it('saves and resets a provider start command', async () => {
    const saveProviderLaunchConfig = vi.fn(
      async (input: { provider: 'codex' | 'claude'; command: string | null }) =>
        defaults.map((config) =>
          config.provider === input.provider ? { ...config, command: input.command } : config
        )
    );
    Object.defineProperty(window, 'lumora', {
      configurable: true,
      value: {
        getProviderLaunchConfigs: vi.fn().mockResolvedValue(defaults),
        saveProviderLaunchConfig
      }
    });

    render(
      <ProviderSettings
        onRefresh={vi.fn()}
        status={{ state: 'ready', scan }}
      />
    );

    const input = await screen.findByLabelText('Codex start command');
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
});
