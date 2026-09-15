import { describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS, type ChangesSummary } from '../../shared/contracts';
import { registerChangesIpc } from './register-changes-ipc';

interface InvokeEventStub {
  senderFrame: { url: string } | null;
  sender: { id: number };
}

type InvokeHandler = (event: InvokeEventStub, ...args: readonly unknown[]) => Promise<unknown> | unknown;

const source = { kind: 'session', ownerId: 'connection-1', view: 'session' } as const;

const summary: ChangesSummary = {
  source,
  workspaceId: 'workspace-1',
  state: 'ready',
  unavailableReason: null,
  baselineLate: false,
  sharedWorkspace: false,
  files: [{ path: 'src/a.ts', oldPath: null, status: 'modified', additions: 1, deletions: 0, binary: false }],
  committed: [],
  truncated: false,
  checkedAt: '2026-09-15T01:00:00.000Z'
};

const trustedEvent: InvokeEventStub = {
  sender: { id: 7 },
  senderFrame: { url: 'app://lumora/index.html' }
};

function createHarness(authorize = vi.fn(() => ({ mode: 'local' }))) {
  const handlers = new Map<string, InvokeHandler>();
  const service = {
    summary: vi.fn().mockResolvedValue(summary),
    fileDiff: vi.fn().mockResolvedValue({ path: 'src/a.ts', patch: '+a', binary: false, truncated: false }),
    markReviewed: vi.fn().mockResolvedValue(summary),
    history: vi.fn().mockReturnValue({ segments: [] }),
    open: vi.fn().mockResolvedValue(undefined),
    counts: vi.fn().mockReturnValue([
      { ownerId: 'connection-1', workspaceId: 'workspace-1', state: 'ready', changedFileCount: 1 }
    ])
  };
  registerChangesIpc({
    ipc: {
      handle(channel: string, handler: InvokeHandler) {
        handlers.set(channel, handler);
      }
    },
    authorize: authorize as never,
    service
  });
  const invoke = (channel: string, ...args: readonly unknown[]) => {
    const handler = handlers.get(channel);
    if (handler === undefined) throw new Error(`missing ${channel}`);
    return Promise.resolve(handler(trustedEvent, ...args));
  };
  return { handlers, invoke, service };
}

describe('registerChangesIpc', () => {
  it('registers every changes channel in order and returns validated results', async () => {
    const { handlers, invoke, service } = createHarness();

    expect([...handlers.keys()]).toEqual([
      IPC_CHANNELS.changesSummaryGet,
      IPC_CHANNELS.changesFileDiffGet,
      IPC_CHANNELS.changesReviewMark,
      IPC_CHANNELS.changesHistoryGet,
      IPC_CHANNELS.changesFileOpen,
      IPC_CHANNELS.changesCountsGet
    ]);
    await expect(invoke(IPC_CHANNELS.changesSummaryGet, source)).resolves.toEqual(summary);
    expect(service.summary).toHaveBeenCalledWith(source);
    await expect(invoke(IPC_CHANNELS.changesFileDiffGet, { source, path: 'src/a.ts' }))
      .resolves.toMatchObject({ patch: '+a' });
    expect(service.fileDiff).toHaveBeenCalledWith(source, 'src/a.ts');
    await expect(invoke(IPC_CHANNELS.changesReviewMark, { ownerId: 'connection-1', paths: ['src/a.ts'] }))
      .resolves.toEqual(summary);
    expect(service.markReviewed).toHaveBeenCalledWith('connection-1', ['src/a.ts']);
    await expect(invoke(IPC_CHANNELS.changesHistoryGet, { workspaceId: 'workspace-1' }))
      .resolves.toEqual({ segments: [] });
    expect(service.history).toHaveBeenCalledWith('workspace-1');
    await expect(invoke(IPC_CHANNELS.changesFileOpen, { source, path: 'src/a.ts', action: 'open' }))
      .resolves.toBeNull();
    expect(service.open).toHaveBeenCalledWith(source, 'src/a.ts', 'open');
    await expect(invoke(IPC_CHANNELS.changesCountsGet)).resolves.toHaveLength(1);
  });

  it('rejects an invalid source with the generic error before reaching the service', async () => {
    const { invoke, service } = createHarness();

    await expect(invoke(IPC_CHANNELS.changesSummaryGet, { kind: 'session', ownerId: '../x', view: 'session' }))
      .rejects.toMatchObject({ code: 'CHANGES_OPERATION_FAILED' });
    await expect(invoke(IPC_CHANNELS.changesFileOpen, { source, path: 'a.ts', action: 'delete' }))
      .rejects.toMatchObject({ code: 'CHANGES_OPERATION_FAILED' });
    expect(service.summary).not.toHaveBeenCalled();
    expect(service.open).not.toHaveBeenCalled();
  });

  it('rejects a review without paths', async () => {
    const { invoke, service } = createHarness();

    await expect(invoke(IPC_CHANNELS.changesReviewMark, { ownerId: 'connection-1', paths: [] }))
      .rejects.toMatchObject({ code: 'CHANGES_OPERATION_FAILED' });
    expect(service.markReviewed).not.toHaveBeenCalled();
  });

  it('does not expose service errors or malformed results', async () => {
    const { invoke, service } = createHarness();
    service.summary.mockRejectedValueOnce(new Error('C:\\private\\repo failed'));
    service.counts.mockReturnValueOnce([{ ownerId: 'connection-1', privatePath: 'C:\\x' }]);

    const failure = await invoke(IPC_CHANNELS.changesSummaryGet, source).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'CHANGES_OPERATION_FAILED' });
    expect((failure as Error).message).not.toContain('private');
    await expect(invoke(IPC_CHANNELS.changesCountsGet))
      .rejects.toMatchObject({ code: 'CHANGES_OPERATION_FAILED' });
  });

  it('rejects calls denied by the local-window authorizer', async () => {
    const accessError = Object.assign(new Error('denied'), { code: 'IPC_UNTRUSTED_SENDER' });
    const { invoke, service } = createHarness(vi.fn(() => {
      throw accessError;
    }));

    await expect(invoke(IPC_CHANNELS.changesSummaryGet, source)).rejects.toBe(accessError);
    expect(service.summary).not.toHaveBeenCalled();
  });
});
