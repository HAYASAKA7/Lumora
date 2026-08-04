import type { IpcAuthorizer } from './ipc-access';
import {
  CatalogQuerySchema,
  CatalogSnapshotSchema,
  IPC_CHANNELS,
  type CatalogQuery,
  type CatalogSnapshot
} from '../../shared/contracts';
import { isTrustedRendererUrl } from '../security-policy';

interface IpcInvokeEventLike {
  senderFrame: { url: string } | null;
}

interface IpcRegistrar {
  handle(
    channel: string,
    handler: (
      event: IpcInvokeEventLike,
      ...args: readonly unknown[]
    ) => Promise<unknown> | unknown
  ): void;
}

interface CatalogServiceLike {
  getCatalog(query: CatalogQuery): unknown;
  refreshCatalog(query: CatalogQuery): Promise<unknown>;
  registerWorkspace(path: string): Promise<unknown>;
}

interface OpenDialogResult {
  canceled: boolean;
  filePaths: string[];
}

interface RegisterCatalogIpcDependencies {
  ipc: IpcRegistrar;
  authorize: IpcAuthorizer;
  service: CatalogServiceLike;
  showOpenDialog(options: {
    properties: ['openDirectory'];
  }): Promise<OpenDialogResult>;
  onCatalogRefreshed?(): void;
  developmentOrigin?: string;
}

class IpcAccessError extends Error {
  readonly code = 'IPC_UNTRUSTED_SENDER';

  constructor() {
    super('The IPC request did not originate from the Lumora renderer.');
    this.name = 'IpcAccessError';
  }
}

class CatalogIpcError extends Error {
  readonly code = 'CATALOG_DATABASE_FAILED';

  constructor() {
    super('Lumora could not complete the catalog operation.');
    this.name = 'CatalogIpcError';
  }
}

function assertTrusted(
  event: IpcInvokeEventLike,
  authorize: IpcAuthorizer,
  developmentOrigin?: string
): void {
  authorize(event);
  if (
    event.senderFrame === null ||
    !isTrustedRendererUrl(event.senderFrame.url, developmentOrigin)
  ) {
    throw new IpcAccessError();
  }
}

async function validateCatalogOperation(
  operation: () => Promise<unknown> | unknown,
  afterValidation?: () => void
): Promise<CatalogSnapshot> {
  try {
    const snapshot = CatalogSnapshotSchema.parse(await operation());
    afterValidation?.();
    return snapshot;
  } catch {
    throw new CatalogIpcError();
  }
}

export function registerCatalogIpc({
  ipc,
  authorize,
  service,
  showOpenDialog,
  onCatalogRefreshed,
  developmentOrigin
}: RegisterCatalogIpcDependencies): void {
  ipc.handle(IPC_CHANNELS.catalogGet, async (event, query) => {
    assertTrusted(event, authorize, developmentOrigin);
    const validatedQuery = CatalogQuerySchema.parse(query);
    return validateCatalogOperation(() => service.getCatalog(validatedQuery));
  });

  ipc.handle(IPC_CHANNELS.catalogRefresh, async (event, query) => {
    assertTrusted(event, authorize, developmentOrigin);
    const validatedQuery = CatalogQuerySchema.parse(query);
    return validateCatalogOperation(
      () => service.refreshCatalog(validatedQuery),
      onCatalogRefreshed
    );
  });

  ipc.handle(IPC_CHANNELS.workspaceChoose, async (event) => {
    assertTrusted(event, authorize, developmentOrigin);

    let result: OpenDialogResult;
    try {
      result = await showOpenDialog({ properties: ['openDirectory'] });
    } catch {
      throw new CatalogIpcError();
    }

    const selectedPath = result.filePaths[0];
    if (result.canceled || selectedPath === undefined) {
      return null;
    }

    return validateCatalogOperation(() =>
      service.registerWorkspace(selectedPath)
    );
  });
}
