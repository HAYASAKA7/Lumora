import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProviderScanResult } from '../../shared/contracts';
import App from './App';

const readyProviderScan: ProviderScanResult = {
  scannedAt: '2026-07-11T01:02:03.000Z',
  providers: [
    {
      provider: 'codex',
      displayName: 'Codex',
      state: 'ready',
      executablePath: 'C:\\tools\\codex.exe',
      version: 'codex-cli 1.2.3',
      issue: null
    },
    {
      provider: 'claude',
      displayName: 'Claude Code',
      state: 'ready',
      executablePath: 'C:\\tools\\claude.exe',
      version: '2.3.4 (Claude Code)',
      issue: null
    }
  ]
};

const degradedProviderScan: ProviderScanResult = {
  scannedAt: '2026-07-11T01:03:00.000Z',
  providers: [
    readyProviderScan.providers[0]!,
    {
      provider: 'claude',
      displayName: 'Claude Code',
      state: 'not_found',
      executablePath: null,
      version: null,
      issue: {
        code: 'PROVIDER_NOT_FOUND',
        message: 'Claude Code was not found on PATH.',
        recovery: 'Install Claude Code or add it to PATH, then refresh.',
        retryable: true
      }
    }
  ]
};

function setSystemInfoResult(
  result: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({
    platform: 'win32',
    arch: 'x64',
    appVersion: '0.1.0'
  }),
  scanProviders: ReturnType<typeof vi.fn> = vi
    .fn()
    .mockResolvedValue(readyProviderScan)
): void {
  Object.defineProperty(window, 'lumora', {
    configurable: true,
    value: { getSystemInfo: result, scanProviders }
  });
}

describe('App', () => {
  beforeEach(() => setSystemInfoResult());

  it('opens on Home and exposes the complete primary navigation', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'page'
    );

    for (const destination of [
      'Home',
      'Workspaces',
      'All sessions',
      'Terminal profiles',
      'Settings'
    ]) {
      expect(screen.getByRole('button', { name: destination })).toBeInTheDocument();
    }
  });

  it('changes destination without reloading the page', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('shows platform and architecture after system information resolves', async () => {
    render(<App />);

    expect(screen.getByText('Reading local system')).toBeInTheDocument();
    expect(await screen.findByText('Windows · x64')).toBeInTheDocument();
    expect(screen.getByText('Lumora 0.1.0')).toBeInTheDocument();
  });

  it('shows a non-blocking diagnostic when system information fails', async () => {
    setSystemInfoResult(vi.fn().mockRejectedValue(new Error('IPC unavailable')));
    render(<App />);

    expect(
      await screen.findByText('System details unavailable')
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();
  });

  it('explains each Home dashboard area without fabricated data', () => {
    render(<App />);

    for (const cardTitle of [
      'Running agents',
      'Needs attention',
      'Recent sessions',
      'Scan health'
    ]) {
      expect(screen.getByRole('heading', { name: cardTitle })).toBeInTheDocument();
    }
  });

  it('shows the real ready-provider count on Home', async () => {
    render(<App />);

    expect(await screen.findByText('2 of 2 providers ready')).toBeInTheDocument();
  });

  it('lists detected providers, versions, and paths in Settings', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(
      screen.getByRole('heading', { name: 'Provider installations' })
    ).toBeInTheDocument();
    expect(await screen.findByText('codex-cli 1.2.3')).toBeInTheDocument();
    expect(screen.getByText('2.3.4 (Claude Code)')).toBeInTheDocument();
    expect(screen.getByText('C:\\tools\\codex.exe')).toBeInTheDocument();
    expect(screen.getByText('C:\\tools\\claude.exe')).toBeInTheDocument();
  });

  it('shows an actionable provider diagnostic without hiding healthy providers', async () => {
    setSystemInfoResult(undefined, vi.fn().mockResolvedValue(degradedProviderScan));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(await screen.findByText('codex-cli 1.2.3')).toBeInTheDocument();
    expect(screen.getByText('Not found')).toBeInTheDocument();
    expect(
      screen.getByText('Claude Code was not found on PATH.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Install Claude Code or add it to PATH, then refresh.')
    ).toBeInTheDocument();
  });

  it('keeps navigation usable when the provider scan fails', async () => {
    setSystemInfoResult(
      undefined,
      vi.fn().mockRejectedValue(new Error('provider IPC unavailable'))
    );
    render(<App />);

    expect(
      await screen.findByText('Provider details are unavailable')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('refreshes provider results without reloading the application', async () => {
    const scanProviders = vi
      .fn()
      .mockResolvedValueOnce(degradedProviderScan)
      .mockResolvedValueOnce(readyProviderScan);
    setSystemInfoResult(undefined, scanProviders);
    render(<App />);

    expect(await screen.findByText('1 of 2 providers ready')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(await screen.findByText('2.3.4 (Claude Code)')).toBeInTheDocument();
    expect(scanProviders).toHaveBeenCalledTimes(2);
  });
});
