import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  LaunchPrepareRequest,
  LaunchPreview,
  TerminalProfile
} from '../../../shared/contracts';
import { useLaunchPreflight } from './useLaunchPreflight';

const workspaceId = 'a'.repeat(64);
const profile: TerminalProfile = {
  id: 'b'.repeat(64),
  kind: 'detected',
  name: 'PowerShell 7',
  shellFamily: 'pwsh',
  executablePath: 'C:\\tools\\pwsh.exe',
  args: [],
  available: true,
  recommended: true
};
const firstRequest: LaunchPrepareRequest = {
  strategy: 'new',
  workspaceId,
  provider: 'codex',
  terminalProfileId: null,
  cols: 100,
  rows: 30
};

function launchPreview(
  provider: 'codex' | 'claude',
  tokenSuffix: string
): LaunchPreview {
  return {
    launchToken: `0198f8b6-18f3-7ca0-9f0f-${tokenSuffix}`,
    launchHash: (provider === 'codex' ? 'c' : 'd').repeat(64),
    strategy: 'new',
    sessionId: null,
    provider,
    executablePath: `C:\\tools\\${provider}.exe`,
    args: [],
    command: null,
    workingDirectory: 'D:\\Projects\\Lumora',
    workspaceTrusted: true,
    environmentNames: ['PATH'],
    terminalProfile: profile,
    configuration: [],
    warnings: [],
    createdAt: '2026-07-14T08:00:00.000Z',
    expiresAt: '2026-07-14T08:05:00.000Z'
  };
}

const codexPreview = launchPreview('codex', '123456789abc');
const claudePreview = launchPreview('claude', '123456789abd');

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function installLumora(prepareLaunch: ReturnType<typeof vi.fn>): void {
  Object.defineProperty(window, 'lumora', {
    configurable: true,
    value: { prepareLaunch }
  });
}

describe('useLaunchPreflight', () => {
  it('prepares automatically and ignores a stale response after the request changes', async () => {
    const first = deferred<LaunchPreview>();
    const second = deferred<LaunchPreview>();
    const prepareLaunch = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    installLumora(prepareLaunch);

    const { result, rerender, unmount } = renderHook(
      ({ request }: { request: LaunchPrepareRequest | null }) =>
        useLaunchPreflight(request),
      { initialProps: { request: firstRequest as LaunchPrepareRequest | null } }
    );

    expect(result.current.status).toBe('preparing');
    expect(prepareLaunch).toHaveBeenCalledWith(firstRequest);

    const nextRequest: LaunchPrepareRequest = {
      ...firstRequest,
      provider: 'claude'
    };
    rerender({ request: nextRequest });
    expect(result.current.preview).toBeNull();
    expect(result.current.status).toBe('preparing');
    expect(result.current.isCurrentLaunchToken(codexPreview.launchToken)).toBe(false);

    await act(async () => {
      first.resolve(codexPreview);
      await first.promise;
    });
    expect(result.current.preview).toBeNull();

    await act(async () => {
      second.resolve(claudePreview);
      await second.promise;
    });
    await waitFor(() => expect(result.current.preview).toEqual(claudePreview));
    expect(result.current.status).toBe('ready');
    expect(result.current.isCurrentLaunchToken(claudePreview.launchToken)).toBe(true);

    const isCurrentLaunchToken = result.current.isCurrentLaunchToken;
    unmount();
    expect(isCurrentLaunchToken(claudePreview.launchToken)).toBe(false);
  });

  it('retries a failed request and clears its previous error', async () => {
    const prepareLaunch = vi
      .fn()
      .mockRejectedValueOnce(new Error('prepare'))
      .mockResolvedValueOnce(codexPreview);
    installLumora(prepareLaunch);

    const { result } = renderHook(() => useLaunchPreflight(firstRequest));
    await waitFor(() => expect(result.current.status).toBe('failed'));

    act(() => result.current.retry());
    expect(result.current.status).toBe('preparing');
    expect(result.current.preview).toBeNull();
    await waitFor(() => expect(result.current.preview).toEqual(codexPreview));
    expect(result.current.status).toBe('ready');
    expect(prepareLaunch).toHaveBeenCalledTimes(2);
  });

  it('becomes idle and ignores an invalidated request when eligibility is lost', async () => {
    const pending = deferred<LaunchPreview>();
    const prepareLaunch = vi.fn().mockReturnValue(pending.promise);
    installLumora(prepareLaunch);

    const { result, rerender } = renderHook(
      ({ request }: { request: LaunchPrepareRequest | null }) =>
        useLaunchPreflight(request),
      { initialProps: { request: firstRequest as LaunchPrepareRequest | null } }
    );

    rerender({ request: null });
    expect(result.current.status).toBe('idle');
    expect(result.current.preview).toBeNull();

    await act(async () => {
      pending.resolve(codexPreview);
      await pending.promise;
    });
    expect(result.current.status).toBe('idle');
    expect(result.current.preview).toBeNull();
  });
});
