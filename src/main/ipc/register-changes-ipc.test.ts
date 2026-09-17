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
  places: [{ id: null, name: 'work', path: 'D:\work', baselineLate: false, unavailableReason: null }],
  files: [{ placeId: null, path: 'src/a.ts', oldPath: null, status: 'modified', additions: 1, deletions: 0, binary: false }],
  committed: [],
  truncated: false,
  checkedAt: '2026-09-15T01:00:00.000Z'
};

const trustedEvent: InvokeEventStub = {
  sender: { id: 7 },
  senderFrame: { url: 'app://lumora/index.html' }
};

function createHandlers(
  service: Parameters<typeof registerChangesIpc>[0]['service'],
  authorize = vi.fn(() => ({ mode: 'local' }))
) {
  const handlers = new Map<string, InvokeHandler>();
  const chooseDirectory = async (): Promise<string | null> => null;
  registerChangesIpc({
    ipc: {
      handle(channel: string, handler: InvokeHandler) {
        handlers.set(channel, handler);
      }
    },
    authorize: authorize as never,
    chooseDirectory,
    service
  });
  return handlers;
}

function createHarness(authorize = vi.fn(() => ({ mode: 'local' }))) {
  const handlers = new Map<string, InvokeHandler>();
  const chooseDirectory = vi.fn(async () => 'D:\chosen');
  const service = {
    summary: vi.fn().mockResolvedValue(summary),
    fileDiff: vi.fn().mockResolvedValue({ path: 'src/a.ts', patch: '+a', binary: false, truncated: false }),
    markReviewed: vi.fn().mockResolvedValue(summary),
    history: vi.fn().mockReturnValue({ segments: [] }),
    filePath: vi.fn().mockResolvedValue('D:\\work\\src\\a.ts'),
    open: vi.fn().mockResolvedValue({ outcome: 'opened' }),
    counts: vi.fn().mockReturnValue([
      { ownerId: 'connection-1', workspaceId: 'workspace-1', state: 'ready', changedFileCount: 1 }
    ]),
    places: vi.fn().mockReturnValue(summary.places),
    addPlace: vi.fn().mockResolvedValue(summary.places),
    removePlace: vi.fn().mockReturnValue(summary.places),
    suggestPlace: vi.fn().mockResolvedValue({ path: 'D:\work', name: 'work' })
  };
  registerChangesIpc({
    ipc: {
      handle(channel: string, handler: InvokeHandler) {
        handlers.set(channel, handler);
      }
    },
    authorize: authorize as never,
    chooseDirectory,
    service
  });
  const invoke = (channel: string, ...args: readonly unknown[]) => {
    const handler = handlers.get(channel);
    if (handler === undefined) throw new Error(`missing ${channel}`);
    return Promise.resolve(handler(trustedEvent, ...args));
  };
  return { chooseDirectory, handlers, invoke, service };
}

describe('registerChangesIpc', () => {
  it('registers every changes channel in order and returns validated results', async () => {
    const { handlers, invoke, service } = createHarness();

    expect([...handlers.keys()]).toEqual([
      IPC_CHANNELS.changesSummaryGet,
      IPC_CHANNELS.changesFileDiffGet,
      IPC_CHANNELS.changesReviewMark,
      IPC_CHANNELS.changesHistoryGet,
      IPC_CHANNELS.changesFilePathGet,
      IPC_CHANNELS.changesFileOpen,
      IPC_CHANNELS.changesPlacesGet,
      IPC_CHANNELS.changesPlaceAdd,
      IPC_CHANNELS.changesPlaceRemove,
      IPC_CHANNELS.changesPlaceSuggest,
      IPC_CHANNELS.changesCountsGet
    ]);
    await expect(invoke(IPC_CHANNELS.changesSummaryGet, source)).resolves.toEqual(summary);
    expect(service.summary).toHaveBeenCalledWith(source);
    await expect(invoke(IPC_CHANNELS.changesFileDiffGet, { source, path: 'src/a.ts' }))
      .resolves.toMatchObject({ patch: '+a' });
    expect(service.fileDiff).toHaveBeenCalledWith(source, null, 'src/a.ts');
    await expect(invoke(IPC_CHANNELS.changesReviewMark, {
      ownerId: 'connection-1', files: [{ path: 'src/a.ts' }]
    })).resolves.toEqual(summary);
    expect(service.markReviewed).toHaveBeenCalledWith('connection-1', [{ placeId: null, path: 'src/a.ts' }]);
    await expect(invoke(IPC_CHANNELS.changesHistoryGet, { workspaceId: 'workspace-1' }))
      .resolves.toEqual({ segments: [] });
    expect(service.history).toHaveBeenCalledWith('workspace-1');
    await expect(invoke(IPC_CHANNELS.changesFilePathGet, { source, path: 'src/a.ts' }))
      .resolves.toEqual({ path: 'D:\\work\\src\\a.ts' });
    expect(service.filePath).toHaveBeenCalledWith(source, null, 'src/a.ts');
    service.filePath.mockRejectedValueOnce(new Error('outside'));
    await expect(invoke(IPC_CHANNELS.changesFilePathGet, { source, path: '../escape.ts' }))
      .rejects.toMatchObject({ code: 'CHANGES_OPERATION_FAILED' });

    await expect(invoke(IPC_CHANNELS.changesFileOpen, { source, path: 'src/a.ts', action: 'open' }))
      .resolves.toEqual({ outcome: 'opened' });
    expect(service.open).toHaveBeenCalledWith(source, null, 'src/a.ts', 'open');
    service.open.mockResolvedValueOnce({ outcome: 'confirm-required' });
    await expect(invoke(IPC_CHANNELS.changesFileOpen, { source, path: 'tool.py', action: 'open' }))
      .resolves.toEqual({ outcome: 'confirm-required' });
    service.open.mockResolvedValueOnce({ outcome: 'opened' });
    await expect(invoke(IPC_CHANNELS.changesFileOpen, { source, path: 'tool.py', action: 'open-anyway' }))
      .resolves.toEqual({ outcome: 'opened' });
    expect(service.open).toHaveBeenLastCalledWith(source, null, 'tool.py', 'open-anyway');
    await expect(invoke(IPC_CHANNELS.changesPlacesGet, { workspaceId: 'workspace-1' }))
      .resolves.toEqual(summary.places);
    await expect(invoke(IPC_CHANNELS.changesPlaceAdd, { workspaceId: 'workspace-1', path: 'D:\lib' }))
      .resolves.toEqual(summary.places);
    expect(service.addPlace).toHaveBeenCalledWith('workspace-1', 'D:\lib');
    await expect(invoke(IPC_CHANNELS.changesPlaceRemove, { workspaceId: 'workspace-1', placeId: 'place-1' }))
      .resolves.toEqual(summary.places);
    await expect(invoke(IPC_CHANNELS.changesPlaceSuggest, { workspaceId: 'workspace-1' }))
      .resolves.toEqual({ path: 'D:\work', name: 'work' });
    await expect(invoke(IPC_CHANNELS.changesCountsGet)).resolves.toHaveLength(1);
  });

  it('rejects an invalid source with the generic error before reaching the service', async () => {
    const { invoke, service } = createHarness();

    await expect(invoke(IPC_CHANNELS.changesSummaryGet, { kind: 'session', ownerId: '../x', view: 'session' }))
      .rejects.toMatchObject({ code: 'CHANGES_OPERATION_FAILED' });
    await expect(invoke(IPC_CHANNELS.changesFileOpen, { source, path: 'a.ts', action: 'delete' }))
      .rejects.toMatchObject({ code: 'CHANGES_OPERATION_FAILED' });
    const harness = createHarness();
    harness.service.open.mockResolvedValue({ outcome: 'run' });
    await expect(harness.invoke(IPC_CHANNELS.changesFileOpen, { source, path: 'a.ts', action: 'open' }))
      .rejects.toMatchObject({ code: 'CHANGES_OPERATION_FAILED' });
    expect(service.summary).not.toHaveBeenCalled();
    expect(service.open).not.toHaveBeenCalled();
  });

  it('rejects a review without files', async () => {
    const { invoke, service } = createHarness();

    await expect(invoke(IPC_CHANNELS.changesReviewMark, { ownerId: 'connection-1', files: [] }))
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

  it('answers every call with the generic error when this computer has no tracking', async () => {
    const handlers = createHandlers(null);
    const invoke = (channel: string, ...args: readonly unknown[]) =>
      Promise.resolve(handlers.get(channel)?.(trustedEvent, ...args));

    await expect(invoke(IPC_CHANNELS.changesSummaryGet, source)).rejects.toMatchObject({
      code: 'CHANGES_OPERATION_FAILED'
    });
    await expect(invoke(IPC_CHANNELS.changesHistoryGet, { workspaceId: 'workspace-1' })).rejects.toMatchObject({
      code: 'CHANGES_OPERATION_FAILED'
    });
    await expect(invoke(IPC_CHANNELS.changesFilePathGet, { source, path: 'src/a.ts' })).rejects.toMatchObject({
      code: 'CHANGES_OPERATION_FAILED'
    });
    await expect(invoke(IPC_CHANNELS.changesCountsGet)).resolves.toEqual([]);
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
