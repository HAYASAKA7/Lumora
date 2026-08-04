import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { LumoraApi } from '../../shared/contracts';
import { WindowRoot } from './WindowRoot';

const TARGET_ID = '0e3f3da6-b340-49f6-b03b-8ae032c3af74';

describe('WindowRoot', () => {
  it('mounts the isolated remote shell without starting local application scans', async () => {
    const api = {
      getWindowContext: vi.fn().mockResolvedValue({
        mode: 'remote', executionTargetId: TARGET_ID
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
});
