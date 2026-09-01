import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  AgentRuntimeStartResult,
  LaunchPreview,
  RuntimeSummary,
  SessionSummary,
  WorkspaceSummary
} from '../../../shared/contracts';
import { useDirectSessionLaunch } from './useDirectSessionLaunch';

const session = {
  id: 'session-1',
  provider: 'codex',
  title: 'Review Lumora',
  workspaceId: 'workspace-1'
} as SessionSummary;

const workspace = {
  id: 'workspace-1',
  displayName: 'Lumora',
  canonicalPath: 'D:\\Projects\\AI\\Lumora'
} as WorkspaceSummary;

const preview = {
  launchToken: '00000000-0000-4000-8000-000000000001',
  workspaceTrusted: false
} as LaunchPreview;

const runtime = {
  id: 'runtime-1',
  state: 'running'
} as RuntimeSummary;

describe('useDirectSessionLaunch', () => {
  it('cancels an agent launch and ignores a late successful result when closed', async () => {
    let resolveRuntime!: (value: AgentRuntimeStartResult) => void;
    const operationId = '00000000-0000-4000-8000-000000000002';
    const resultValue = {
      mode: 'pty' as const,
      routeReason: 'structured_failed' as const,
      runtime
    };
    const api = {
      prepareLaunch: vi.fn().mockResolvedValue({
        ...preview,
        workspaceTrusted: true
      }),
      trustWorkspaceForLaunch: vi.fn(),
      startRuntime: vi.fn(),
      startAgentRuntime: vi.fn(() => new Promise<AgentRuntimeStartResult>((resolve) => {
        resolveRuntime = resolve;
      })),
      cancelAgentRuntimeStart: vi.fn().mockResolvedValue(undefined)
    };
    const onStarted = vi.fn();
    const { result } = renderHook(() => useDirectSessionLaunch({
      api,
      autoTrustWorkspaces: false,
      mode: 'agent',
      onStarted,
      createOperationId: () => operationId
    }));

    act(() => result.current.open(session, workspace));
    await waitFor(() => expect(result.current.launch?.phase).toBe('starting'));

    await act(async () => result.current.cancel());
    expect(api.cancelAgentRuntimeStart).toHaveBeenCalledWith(operationId);
    expect(result.current.hasLaunch).toBe(false);

    await act(async () => {
      resolveRuntime(resultValue);
      await Promise.resolve();
    });
    await waitFor(() => expect(api.startAgentRuntime).toHaveBeenCalledWith(
      preview.launchToken,
      operationId
    ));
    expect(onStarted).not.toHaveBeenCalled();
  });

  it('does not start an agent when closed while launch preparation is pending', async () => {
    let resolvePreview!: (value: LaunchPreview) => void;
    const operationId = '00000000-0000-4000-8000-000000000003';
    const api = {
      prepareLaunch: vi.fn(() => new Promise<LaunchPreview>((resolve) => {
        resolvePreview = resolve;
      })),
      trustWorkspaceForLaunch: vi.fn(),
      startRuntime: vi.fn(),
      startAgentRuntime: vi.fn(),
      cancelAgentRuntimeStart: vi.fn().mockResolvedValue(undefined)
    };
    const { result } = renderHook(() => useDirectSessionLaunch({
      api,
      autoTrustWorkspaces: false,
      mode: 'agent',
      onStarted: vi.fn(),
      createOperationId: () => operationId
    }));

    act(() => result.current.open(session, workspace));
    await waitFor(() => expect(result.current.launch?.phase).toBe('preparing'));
    await act(async () => result.current.cancel());
    await act(async () => {
      resolvePreview({ ...preview, workspaceTrusted: true });
      await Promise.resolve();
    });

    expect(api.cancelAgentRuntimeStart).toHaveBeenCalledWith(operationId);
    expect(api.startAgentRuntime).not.toHaveBeenCalled();
    expect(result.current.hasLaunch).toBe(false);
  });

  it('waits inside the session surface for explicit workspace trust', async () => {
    const api = {
      prepareLaunch: vi.fn().mockResolvedValue(preview),
      trustWorkspaceForLaunch: vi.fn().mockResolvedValue({}),
      startRuntime: vi.fn().mockResolvedValue(runtime)
    };
    const onStarted = vi.fn();
    const { result } = renderHook(() => useDirectSessionLaunch({
      api,
      autoTrustWorkspaces: false,
      mode: 'pty',
      onStarted
    }));

    act(() => result.current.open(session, workspace));

    await waitFor(() => expect(result.current.launch?.phase).toBe('awaiting-trust'));
    expect(api.startRuntime).not.toHaveBeenCalled();

    act(() => result.current.trustAndContinue());

    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(
      runtime,
      expect.objectContaining({ workspaceTrusted: true }),
      true
    ));
  });

  it('auto-trusts the exact prepared launch and starts without a dialog', async () => {
    const api = {
      prepareLaunch: vi.fn().mockResolvedValue(preview),
      trustWorkspaceForLaunch: vi.fn().mockResolvedValue({}),
      startRuntime: vi.fn().mockResolvedValue(runtime)
    };
    const onStarted = vi.fn();
    const { result } = renderHook(() => useDirectSessionLaunch({
      api,
      autoTrustWorkspaces: true,
      mode: 'pty',
      onStarted
    }));

    act(() => result.current.open(session, workspace));

    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(api.trustWorkspaceForLaunch).toHaveBeenCalledWith(preview.launchToken);
    expect(api.startRuntime).toHaveBeenCalledWith(preview.launchToken);
  });

  it('does not steal navigation focus when a background launch finishes', async () => {
    let resolveRuntime!: (value: RuntimeSummary) => void;
    const api = {
      prepareLaunch: vi.fn().mockResolvedValue({ ...preview, workspaceTrusted: true }),
      trustWorkspaceForLaunch: vi.fn(),
      startRuntime: vi.fn(() => new Promise<RuntimeSummary>((resolve) => {
        resolveRuntime = resolve;
      }))
    };
    const onStarted = vi.fn();
    const { result } = renderHook(() => useDirectSessionLaunch({
      api,
      autoTrustWorkspaces: false,
      mode: 'pty',
      onStarted
    }));

    act(() => result.current.open(session, workspace));
    await waitFor(() => expect(result.current.launch?.phase).toBe('starting'));
    act(() => result.current.hide());
    act(() => resolveRuntime(runtime));

    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(
      runtime,
      expect.anything(),
      false
    ));
  });

  it('keeps a background launch available and reopens it without starting twice', async () => {
    const api = {
      prepareLaunch: vi.fn().mockResolvedValue({
        ...preview,
        workspaceTrusted: true
      }),
      trustWorkspaceForLaunch: vi.fn(),
      startRuntime: vi.fn(() => new Promise<RuntimeSummary>(() => undefined))
    };
    const { result } = renderHook(() => useDirectSessionLaunch({
      api,
      autoTrustWorkspaces: false,
      mode: 'pty',
      onStarted: vi.fn()
    }));

    act(() => result.current.open(session, workspace));
    await waitFor(() => expect(result.current.launch?.phase).toBe('starting'));

    act(() => result.current.hide());
    expect(result.current.launch).toBeNull();

    act(() => result.current.open(session, workspace));
    expect(result.current.launch).toMatchObject({
      phase: 'starting',
      session: { id: session.id }
    });
    expect(api.prepareLaunch).toHaveBeenCalledTimes(1);
    expect(api.startRuntime).toHaveBeenCalledTimes(1);
  });
});
