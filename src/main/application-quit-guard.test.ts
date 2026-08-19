import { describe, expect, it, vi } from 'vitest';

import { createApplicationQuitGuard } from './application-quit-guard';

const activeCounts = {
  localActiveAgentCount: 2,
  remoteActiveAgentCount: 3,
  totalActiveAgentCount: 5
} as const;

describe('createApplicationQuitGuard', () => {
  it('proceeds without a request when warning is disabled or no agents are active', () => {
    const sendRequest = vi.fn(() => true);
    const guard = createApplicationQuitGuard({ sendRequest });

    expect(guard.request({ warn: false, counts: activeCounts })).toBe('proceed');
    expect(guard.request({
      warn: true,
      counts: {
        localActiveAgentCount: 0,
        remoteActiveAgentCount: 0,
        totalActiveAgentCount: 0
      }
    })).toBe('proceed');
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it('coalesces active requests and resolves one pending confirmation', () => {
    const sendRequest = vi.fn(() => true);
    const guard = createApplicationQuitGuard({ sendRequest });

    expect(guard.request({ warn: true, counts: activeCounts })).toBe('pending');
    expect(guard.request({ warn: true, counts: activeCounts })).toBe('pending');
    expect(sendRequest).toHaveBeenCalledOnce();
    expect(sendRequest).toHaveBeenCalledWith(activeCounts);
    expect(guard.resolve({ action: 'cancel', suppressFutureWarning: false })).toBe(true);
    expect(guard.resolve({ action: 'exit', suppressFutureWarning: false })).toBe(false);
  });

  it('falls through when the renderer cannot receive the warning', () => {
    const guard = createApplicationQuitGuard({ sendRequest: () => false });
    expect(guard.request({ warn: true, counts: activeCounts })).toBe('proceed');
  });
});
