import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { LumoraApi } from '../../../shared/contracts';
import { AboutPanel } from './AboutPanel';

function api(status: 'current' | 'update_available' = 'current') {
  return {
    getApplicationAboutInfo: vi.fn().mockResolvedValue({
      productName: 'Lumora', developer: 'HAYASAKA7',
      system: { platform: 'win32', arch: 'x64', appVersion: '0.3.5' }
    }),
    getApplicationReleaseStatus: vi.fn().mockResolvedValue(
      status === 'current'
        ? { state: 'current', installedVersion: '0.3.5', latestVersion: '0.3.5' }
        : {
            state: 'update_available', installedVersion: '0.3.5',
            release: {
              version: '0.3.6', publishedAt: '2026-08-20T00:00:00.000Z',
              summary: 'A safer Lumora release.',
              url: 'https://github.com/HAYASAKA7/Lumora/releases/tag/v0.3.6'
            }
          }
    ),
    openLumoraProjectPage: vi.fn().mockResolvedValue({ opened: true }),
    openApplicationReleasePage: vi.fn().mockResolvedValue({ opened: true })
  } as unknown as LumoraApi;
}

describe('AboutPanel', () => {
  it('shows stable local product information without an up-to-date banner', async () => {
    const client = api();
    render(<AboutPanel active api={client} />);
    expect(await screen.findByRole('heading', { name: 'Lumora' })).toBeInTheDocument();
    expect(screen.getByText('HAYASAKA7')).toBeInTheDocument();
    expect(screen.getByText('Windows · x64')).toBeInTheDocument();
    expect(screen.queryByText('Update available')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open GitHub project' }));
    expect(client.openLumoraProjectPage).toHaveBeenCalledOnce();
  });

  it('shows only a newer release and includes remote helper information', async () => {
    const client = api('update_available');
    render(<AboutPanel
      active
      api={client}
      remoteTarget={{
        connectionState: 'ready', platform: 'linux', architecture: 'arm64',
        helperVersion: '0.3.5'
      }}
    />);
    expect(await screen.findByText('Update available')).toBeInTheDocument();
    expect(screen.getByText('0.3.6')).toBeInTheDocument();
    expect(screen.getByText('Linux · arm64')).toBeInTheDocument();
    expect(screen.getByText('Helper 0.3.5')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View update' }));
    await waitFor(() => expect(client.openApplicationReleasePage).toHaveBeenCalledOnce());
  });
});
