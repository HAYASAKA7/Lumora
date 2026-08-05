import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_GENERAL_SETTINGS,
  type LumoraApi
} from '../../shared/contracts';
import { WindowRoot } from './WindowRoot';

const TARGET_ID = '0e3f3da6-b340-49f6-b03b-8ae032c3af74';

describe('WindowRoot', () => {
  it('mounts the isolated remote shell without starting local application scans', async () => {
    const api = {
      getWindowContext: vi.fn().mockResolvedValue({
        mode: 'remote', executionTargetId: TARGET_ID
      }),
      getAppearancePresentation: vi.fn().mockResolvedValue({
        appearance: DEFAULT_GENERAL_SETTINGS.appearance,
        background: { available: false, revision: null }
      }),
      listRemoteTargets: vi.fn().mockResolvedValue([]),
      getSystemInfo: vi.fn(),
      scanProviders: vi.fn(),
      getCatalog: vi.fn()
    } as unknown as LumoraApi;

    render(<WindowRoot api={api} />);

    expect(await screen.findByText('This remote target is unavailable.'))
      .toBeInTheDocument();
    expect(api.getSystemInfo).not.toHaveBeenCalled();
    expect(api.scanProviders).not.toHaveBeenCalled();
    expect(api.getCatalog).not.toHaveBeenCalled();
  });

  it('applies the global appearance and managed background to the remote shell', async () => {
    const api = {
      getWindowContext: vi.fn().mockResolvedValue({
        mode: 'remote', executionTargetId: TARGET_ID
      }),
      getAppearancePresentation: vi.fn().mockResolvedValue({
        appearance: {
          ...DEFAULT_GENERAL_SETTINGS.appearance,
          theme: 'dark',
          backgroundEnabled: true,
          surfaceMosaic: 9
        },
        background: { available: true, revision: '1720000000000-4096' }
      }),
      listRemoteTargets: vi.fn().mockResolvedValue([])
    } as unknown as LumoraApi;

    render(<WindowRoot api={api} />);

    const shell = await screen.findByTestId('remote-appearance-root');
    expect(shell).toHaveAttribute('data-theme', 'dark');
    expect(shell).toHaveClass('has-appearance-background', 'has-surface-mosaic');
    expect(shell.getAttribute('style')).toContain('--appearance-surface-mosaic: 9px');
    expect(shell.querySelector('.appearance-background-layer')).toHaveStyle({
      backgroundImage:
        'url("app://appearance/background?revision=1720000000000-4096")'
    });
  });

  it('refreshes global appearance when a remote window regains focus', async () => {
    const getAppearancePresentation = vi.fn()
      .mockResolvedValueOnce({
        appearance: {
          ...DEFAULT_GENERAL_SETTINGS.appearance,
          theme: 'dark'
        },
        background: { available: false, revision: null }
      })
      .mockResolvedValueOnce({
        appearance: {
          ...DEFAULT_GENERAL_SETTINGS.appearance,
          theme: 'light'
        },
        background: { available: false, revision: null }
      });
    const api = {
      getWindowContext: vi.fn().mockResolvedValue({
        mode: 'remote', executionTargetId: TARGET_ID
      }),
      getAppearancePresentation,
      listRemoteTargets: vi.fn().mockResolvedValue([])
    } as unknown as LumoraApi;

    render(<WindowRoot api={api} />);
    expect(await screen.findByTestId('remote-appearance-root'))
      .toHaveAttribute('data-theme', 'dark');

    fireEvent.focus(window);

    await waitFor(() => {
      expect(screen.getByTestId('remote-appearance-root'))
        .toHaveAttribute('data-theme', 'light');
    });
    expect(getAppearancePresentation).toHaveBeenCalledTimes(2);
  });
});
