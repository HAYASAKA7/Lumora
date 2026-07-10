import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';

function setSystemInfoResult(
  result: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({
    platform: 'win32',
    arch: 'x64',
    appVersion: '0.1.0'
  })
): void {
  Object.defineProperty(window, 'lumora', {
    configurable: true,
    value: { getSystemInfo: result }
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
});
