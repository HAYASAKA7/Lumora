import type { IpcAuthorizer } from './ipc-access';
import { join } from 'node:path';

import {
  IPC_CHANNELS,
  SessionExportExecuteRequestSchema,
  SessionExportPlanSchema,
  SessionExportPrepareRequestSchema,
  SessionImportExecuteRequestSchema,
  SessionImportInspectRequestSchema,
  SessionImportInspectionSchema,
  SessionImportPlanRequestSchema,
  SessionImportPlanSchema,
  SessionTransferArchiveSelectionSchema,
  SessionTransferCapabilityListSchema,
  SessionTransferResultSchema,
  TransferHistoryListSchema,
  TransferOperationCancelRequestSchema,
  TransferOperationCancelResultSchema,
  WorkspaceSummarySchema
} from '../../shared/contracts';
import { isTrustedRendererUrl } from '../security-policy';
import type { SessionTransferService } from '../transfer/session-transfer-service';

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

type TransferIpcService = Pick<
  SessionTransferService,
  | 'getCapabilities'
  | 'prepareExport'
  | 'executeExport'
  | 'chooseImportArchive'
  | 'inspectImport'
  | 'planImport'
  | 'executeImport'
  | 'getHistory'
  | 'cancelOperation'
>;

interface SaveDialogResult {
  canceled: boolean;
  filePath?: string;
}

interface OpenDialogResult {
  canceled: boolean;
  filePaths: string[];
}

interface SaveArchiveDialogOptions {
  defaultPath: string;
  filters: Array<{ name: string; extensions: string[] }>;
  properties: Array<'showOverwriteConfirmation' | 'createDirectory'>;
}

interface OpenArchiveDialogOptions {
  defaultPath: string;
  filters: Array<{ name: string; extensions: string[] }>;
  properties: ['openFile'];
}

interface WorkspaceDialogOptions {
  properties: ['openDirectory'];
}

interface RegisterTransferIpcDependencies {
  ipc: IpcRegistrar;
  authorize: IpcAuthorizer;
  service: TransferIpcService;
  downloadsDirectory: string;
  lastDirectory(direction: 'export' | 'import'): string | null;
  showSaveDialog(options: SaveArchiveDialogOptions): Promise<SaveDialogResult>;
  showOpenDialog(
    options: OpenArchiveDialogOptions | WorkspaceDialogOptions
  ): Promise<OpenDialogResult>;
  registerWorkspace(path: string): Promise<unknown>;
  clock?: () => Date;
  developmentOrigin?: string;
}

class IpcAccessError extends Error {
  readonly code = 'IPC_UNTRUSTED_SENDER';

  constructor() {
    super('The IPC request did not originate from the Lumora renderer.');
    this.name = 'IpcAccessError';
  }
}

export class SessionTransferIpcError extends Error {
  readonly code = 'SESSION_TRANSFER_FAILED';

  constructor() {
    super('Lumora could not complete the session transfer.');
    this.name = 'SessionTransferIpcError';
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

async function privileged<T>(operation: () => Promise<T> | T): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new SessionTransferIpcError();
  }
}

const ARCHIVE_FILTER = [
  { name: 'Lumora Sessions', extensions: ['lumora-sessions'] }
];

export function registerTransferIpc({
  ipc,
  authorize,
  service,
  downloadsDirectory,
  lastDirectory,
  showSaveDialog,
  showOpenDialog,
  registerWorkspace,
  clock = () => new Date(),
  developmentOrigin
}: RegisterTransferIpcDependencies): void {
  ipc.handle(IPC_CHANNELS.transferCapabilitiesGet, async (event) => {
    assertTrusted(event, authorize, developmentOrigin);
    return privileged(() =>
      SessionTransferCapabilityListSchema.parse(service.getCapabilities())
    );
  });

  ipc.handle(IPC_CHANNELS.transferExportPrepare, async (event, input) => {
    assertTrusted(event, authorize, developmentOrigin);
    const request = SessionExportPrepareRequestSchema.parse(input);
    return privileged(async () =>
      SessionExportPlanSchema.parse(await service.prepareExport(request))
    );
  });

  ipc.handle(IPC_CHANNELS.transferExportExecute, async (event, input) => {
    assertTrusted(event, authorize, developmentOrigin);
    const request = SessionExportExecuteRequestSchema.parse(input);
    return privileged(async () => {
      const date = clock().toISOString().slice(0, 10);
      const directory = lastDirectory('export') ?? downloadsDirectory;
      const result = await showSaveDialog({
        defaultPath: join(
          directory,
          `Lumora-Sessions-${date}.lumora-sessions`
        ),
        filters: ARCHIVE_FILTER,
        properties: ['showOverwriteConfirmation', 'createDirectory']
      });
      if (result.canceled || result.filePath === undefined) return null;
      return SessionTransferResultSchema.parse(
        await service.executeExport(request, result.filePath)
      );
    });
  });

  ipc.handle(IPC_CHANNELS.transferImportChoose, async (event) => {
    assertTrusted(event, authorize, developmentOrigin);
    return privileged(async () => {
      const result = await showOpenDialog({
        defaultPath: lastDirectory('import') ?? downloadsDirectory,
        filters: ARCHIVE_FILTER,
        properties: ['openFile']
      });
      const archivePath = result.filePaths[0];
      if (result.canceled || archivePath === undefined) return null;
      return SessionTransferArchiveSelectionSchema.parse(
        await service.chooseImportArchive(archivePath)
      );
    });
  });

  ipc.handle(IPC_CHANNELS.transferImportInspect, async (event, input) => {
    assertTrusted(event, authorize, developmentOrigin);
    const request = SessionImportInspectRequestSchema.parse(input);
    return privileged(async () =>
      SessionImportInspectionSchema.parse(await service.inspectImport(request))
    );
  });

  ipc.handle(IPC_CHANNELS.transferImportPlan, async (event, input) => {
    assertTrusted(event, authorize, developmentOrigin);
    const request = SessionImportPlanRequestSchema.parse(input);
    return privileged(async () =>
      SessionImportPlanSchema.parse(await service.planImport(request))
    );
  });

  ipc.handle(IPC_CHANNELS.transferImportExecute, async (event, input) => {
    assertTrusted(event, authorize, developmentOrigin);
    const request = SessionImportExecuteRequestSchema.parse(input);
    return privileged(async () =>
      SessionTransferResultSchema.parse(await service.executeImport(request))
    );
  });

  ipc.handle(IPC_CHANNELS.transferWorkspaceChoose, async (event) => {
    assertTrusted(event, authorize, developmentOrigin);
    return privileged(async () => {
      const result = await showOpenDialog({ properties: ['openDirectory'] });
      const workspacePath = result.filePaths[0];
      if (result.canceled || workspacePath === undefined) return null;
      return WorkspaceSummarySchema.parse(
        await registerWorkspace(workspacePath)
      );
    });
  });

  ipc.handle(IPC_CHANNELS.transferHistoryGet, async (event) => {
    assertTrusted(event, authorize, developmentOrigin);
    return privileged(() => TransferHistoryListSchema.parse(service.getHistory()));
  });

  ipc.handle(IPC_CHANNELS.transferOperationCancel, async (event, input) => {
    assertTrusted(event, authorize, developmentOrigin);
    const request = TransferOperationCancelRequestSchema.parse(input);
    return privileged(() =>
      TransferOperationCancelResultSchema.parse(
        service.cancelOperation(request.operationId)
      )
    );
  });
}
