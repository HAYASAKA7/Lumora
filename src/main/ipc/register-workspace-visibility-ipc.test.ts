import { describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '../../shared/contracts';
import { registerWorkspaceVisibilityIpc } from './register-workspace-visibility-ipc';

const WORKSPACE_ID = 'a'.repeat(64);
const POLICY = {
  workspaceId: WORKSPACE_ID,
  mode: 'workspace_only' as const,
  updatedAt: '2026-08-12T01:00:00.000Z'
};

interface InvokeEventStub {
  senderFrame: { url: string } | null;
}

type InvokeHandler = (
  event: InvokeEventStub,
  ...args: readonly unknown[]
) => Promise<unknown> | unknown;

function createHarness() {
  const handlers = new Map<string, InvokeHandler>();
  const context = {
    mode: 'remote' as const,
    executionTargetId: '4f632901-1f8d-44c0-8418-aa823f791ca0'
  };
  const authorize = vi.fn(() => context);
  const service = {
    getPolicies: vi.fn(() => [POLICY]),
    setPolicy: vi.fn(() => [POLICY]),
    restorePolicies: vi.fn(() => []),
    restoreAll: vi.fn(() => [])
  };
  const resolveService = vi.fn(() => service);
  registerWorkspaceVisibilityIpc({
    ipc: { handle: (channel, handler) => handlers.set(channel, handler) },
    authorize,
    resolveService
  });
  return { handlers, context, authorize, service, resolveService };
}

const trustedEvent = (): InvokeEventStub => ({
  senderFrame: { url: 'app://lumora/index.html' }
});

describe('registerWorkspaceVisibilityIpc', () => {
  it('registers and routes all operations from the authorized window context', async () => {
    const { handlers, context, resolveService } = createHarness();

    await expect(handlers.get(IPC_CHANNELS.workspaceVisibilityGet)!(trustedEvent()))
      .resolves.toEqual([POLICY]);
    await expect(handlers.get(IPC_CHANNELS.workspaceVisibilitySet)!(
      trustedEvent(), { workspaceId: WORKSPACE_ID, mode: 'workspace_only' }
    )).resolves.toEqual([POLICY]);
    await expect(handlers.get(IPC_CHANNELS.workspaceVisibilityRestore)!(
      trustedEvent(), { workspaceIds: [WORKSPACE_ID] }
    )).resolves.toEqual([]);
    await expect(handlers.get(IPC_CHANNELS.workspaceVisibilityRestoreAll)!(
      trustedEvent()
    )).resolves.toEqual([]);

    expect(resolveService).toHaveBeenCalledTimes(4);
    expect(resolveService).toHaveBeenCalledWith(context);
  });

  it('rejects renderer-supplied target authority and malformed responses', async () => {
    const { handlers, service } = createHarness();

    await expect(handlers.get(IPC_CHANNELS.workspaceVisibilitySet)!(
      trustedEvent(), {
        workspaceId: WORKSPACE_ID,
        mode: 'workspace_only',
        executionTargetId: 'local'
      }
    )).rejects.toBeDefined();
    expect(service.setPolicy).not.toHaveBeenCalled();

    service.getPolicies.mockReturnValueOnce([
      { ...POLICY, transcript: 'private' } as typeof POLICY
    ]);
    await expect(handlers.get(IPC_CHANNELS.workspaceVisibilityGet)!(trustedEvent()))
      .rejects.toMatchObject({ code: 'WORKSPACE_VISIBILITY_FAILED' });
  });

  it('authorizes before resolving target services', async () => {
    const { handlers, authorize, resolveService } = createHarness();
    authorize.mockImplementationOnce(() => {
      throw new Error('IPC_UNTRUSTED_SENDER');
    });

    await expect(handlers.get(IPC_CHANNELS.workspaceVisibilityGet)!(trustedEvent()))
      .rejects.toThrow('IPC_UNTRUSTED_SENDER');
    expect(resolveService).not.toHaveBeenCalled();
  });
});
