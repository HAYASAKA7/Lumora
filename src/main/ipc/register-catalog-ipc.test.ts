import { describe, expect, it, vi } from 'vitest';

import {
  CatalogSnapshotSchema,
  IPC_CHANNELS,
  type CatalogQuery,
  type CatalogSnapshot
} from '../../shared/contracts';
import { registerCatalogIpc } from './register-catalog-ipc';

interface InvokeEventStub {
  senderFrame: { url: string } | null;
}

type InvokeHandler = (
  event: InvokeEventStub,
  ...args: readonly unknown[]
) => Promise<unknown> | unknown;

const validSnapshot: CatalogSnapshot = {
  refreshedAt: '2026-07-11T03:00:00.000Z',
  workspaces: [],
  sessions: [],
  providerStatus: [
    {
      provider: 'codex',
      state: 'ready',
      discoveredCount: 0,
      unchangedCount: 0,
      invalidCount: 0
    },
    {
      provider: 'claude',
      state: 'ready',
      discoveredCount: 0,
      unchangedCount: 0,
      invalidCount: 0
    }
  ],
  providerFacets: [],
  diagnostics: []
};

function createHarness(options: {
  authorize?: () => never;
  developmentOrigin?: string;
  dialogResult?: { canceled: boolean; filePaths: string[] };
  getCatalog?: (query: CatalogQuery) => unknown;
  refreshCatalog?: (query: CatalogQuery) => Promise<unknown>;
  registerWorkspace?: (path: string) => Promise<unknown>;
  onCatalogRefreshed?: () => void;
} = {}) {
  const handlers = new Map<string, InvokeHandler>();
  const ipc = {
    handle(channel: string, handler: InvokeHandler) {
      handlers.set(channel, handler);
    }
  };
  const authorize = options.authorize ?? vi.fn(() => ({
    mode: 'local',
    executionTargetId: 'local'
  } as const));
  const service = {
    getCatalog: vi.fn(options.getCatalog ?? (() => validSnapshot)),
    refreshCatalog: vi.fn(
      options.refreshCatalog ?? (async () => validSnapshot)
    ),
    registerWorkspace: vi.fn(
      options.registerWorkspace ?? (async () => validSnapshot)
    )
  };
  const resolveService = vi.fn(() => service);
  const showOpenDialog = vi.fn(async () =>
    Promise.resolve(
      options.dialogResult ?? {
        canceled: false,
        filePaths: ['D:\\Projects\\Lumora']
      }
    )
  );

  registerCatalogIpc({
    ipc,
    authorize,
    resolveService,
    showOpenDialog,
    ...(options.onCatalogRefreshed === undefined
      ? {}
      : { onCatalogRefreshed: options.onCatalogRefreshed }),
    ...(options.developmentOrigin === undefined
      ? {}
      : { developmentOrigin: options.developmentOrigin })
  });

  return { handlers, service, resolveService, showOpenDialog, authorize };
}

function trustedEvent(): InvokeEventStub {
  return { senderFrame: { url: 'app://lumora/index.html' } };
}

describe('registerCatalogIpc', () => {
  it('registers only the three narrowed catalog operations', () => {
    const { handlers } = createHarness();

    expect([...handlers.keys()]).toEqual([
      IPC_CHANNELS.catalogGet,
      IPC_CHANNELS.catalogRefresh,
      IPC_CHANNELS.workspaceChoose
    ]);
  });

  it('authorizes before invoking privileged catalog work', async () => {
    const authorize = vi.fn(() => {
      throw new Error('IPC_UNTRUSTED_SENDER');
    });
    const { handlers, service } = createHarness({ authorize });
    const get = handlers.get(IPC_CHANNELS.catalogGet)!;

    await expect(get(trustedEvent(), { text: '', provider: null }))
      .rejects.toThrow('IPC_UNTRUSTED_SENDER');
    expect(authorize).toHaveBeenCalledOnce();
    expect(service.getCatalog).not.toHaveBeenCalled();
  });

  it('resolves the catalog service from the authorized window context', async () => {
    const { handlers, resolveService } = createHarness();

    await handlers.get(IPC_CHANNELS.catalogGet)!(
      trustedEvent(),
      { text: '', provider: null }
    );

    expect(resolveService).toHaveBeenCalledWith({
      mode: 'local',
      executionTargetId: 'local'
    });
  });

  it('does not accept a request payload as target-routing authority', async () => {
    const { handlers, service } = createHarness();

    await expect(handlers.get(IPC_CHANNELS.catalogGet)!(trustedEvent(), {
      text: '',
      provider: null,
      executionTargetId: '4f632901-1f8d-44c0-8418-aa823f791ca0'
    })).rejects.toBeDefined();
    expect(service.getCatalog).not.toHaveBeenCalled();
  });

  it('validates and forwards normalized get and refresh queries', async () => {
    const onCatalogRefreshed = vi.fn();
    const { handlers, service } = createHarness({ onCatalogRefreshed });
    const get = handlers.get(IPC_CHANNELS.catalogGet)!;
    const refresh = handlers.get(IPC_CHANNELS.catalogRefresh)!;

    await expect(
      get(trustedEvent(), { text: '  storage  ', provider: 'claude' })
    ).resolves.toEqual(validSnapshot);
    await expect(
      refresh(trustedEvent(), { text: '', provider: null })
    ).resolves.toEqual(validSnapshot);

    expect(service.getCatalog).toHaveBeenCalledWith({
      text: 'storage',
      provider: 'claude'
    });
    expect(service.refreshCatalog).toHaveBeenCalledWith({
      text: '',
      provider: null
    });
    expect(onCatalogRefreshed).toHaveBeenCalledOnce();
  });

  it('uses a directory-only native picker and ignores arbitrary renderer paths', async () => {
    const { handlers, service, showOpenDialog } = createHarness();
    const choose = handlers.get(IPC_CHANNELS.workspaceChoose)!;

    const result = await choose(trustedEvent(), 'C:\\untrusted\\renderer-path');

    expect(CatalogSnapshotSchema.parse(result)).toEqual(validSnapshot);
    expect(showOpenDialog).toHaveBeenCalledWith({
      properties: ['openDirectory']
    });
    expect(service.registerWorkspace).toHaveBeenCalledWith(
      'D:\\Projects\\Lumora'
    );
  });

  it('returns null on folder-picker cancellation without registering', async () => {
    const { handlers, service } = createHarness({
      dialogResult: { canceled: true, filePaths: [] }
    });
    const choose = handlers.get(IPC_CHANNELS.workspaceChoose)!;

    await expect(choose(trustedEvent())).resolves.toBeNull();
    expect(service.registerWorkspace).not.toHaveBeenCalled();
  });

  it('accepts only the packaged renderer or exact development origin', async () => {
    const { handlers, service, showOpenDialog } = createHarness({
      developmentOrigin: 'http://localhost:5173'
    });
    const get = handlers.get(IPC_CHANNELS.catalogGet)!;
    const choose = handlers.get(IPC_CHANNELS.workspaceChoose)!;

    await expect(
      get(
        { senderFrame: { url: 'http://localhost:5173/src/main.tsx' } },
        { text: '', provider: null }
      )
    ).resolves.toEqual(validSnapshot);
    await expect(
      get(
        { senderFrame: { url: 'https://example.com/index.html' } },
        { text: '', provider: null }
      )
    ).rejects.toMatchObject({ code: 'IPC_UNTRUSTED_SENDER' });
    await expect(choose({ senderFrame: null })).rejects.toMatchObject({
      code: 'IPC_UNTRUSTED_SENDER'
    });
    expect(service.registerWorkspace).not.toHaveBeenCalled();
    expect(showOpenDialog).not.toHaveBeenCalled();
  });

  it('rejects malformed queries and catalog responses', async () => {
    const invalidQueryHarness = createHarness();
    const get = invalidQueryHarness.handlers.get(IPC_CHANNELS.catalogGet)!;
    await expect(
      get(trustedEvent(), { text: 'x'.repeat(121), provider: null })
    ).rejects.toBeDefined();
    expect(invalidQueryHarness.service.getCatalog).not.toHaveBeenCalled();

    const invalidResponseHarness = createHarness({
      getCatalog: () => ({ ...validSnapshot, transcript: ['private'] })
    });
    await expect(
      invalidResponseHarness.handlers.get(IPC_CHANNELS.catalogGet)!(
        trustedEvent(),
        { text: '', provider: null }
      )
    ).rejects.toMatchObject({ code: 'CATALOG_DATABASE_FAILED' });
  });

  it('normalizes privileged failures without exposing raw details', async () => {
    const onCatalogRefreshed = vi.fn();
    const { handlers } = createHarness({
      onCatalogRefreshed,
      refreshCatalog: async () => {
        throw new Error('SQL and local path details');
      }
    });
    const refresh = handlers.get(IPC_CHANNELS.catalogRefresh)!;

    await expect(
      refresh(trustedEvent(), { text: '', provider: null })
    ).rejects.toMatchObject({
      code: 'CATALOG_DATABASE_FAILED',
      message: 'Lumora could not complete the catalog operation.'
    });
    expect(onCatalogRefreshed).not.toHaveBeenCalled();
  });
});
