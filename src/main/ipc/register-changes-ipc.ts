import {
  ChangesCountListSchema,
  ChangesFileDiffRequestSchema,
  ChangesFileDiffSchema,
  ChangesHistoryRequestSchema,
  ChangesHistorySchema,
  ChangesOpenRequestSchema,
  ChangesReviewRequestSchema,
  ChangesSourceSchema,
  ChangesSummarySchema,
  IPC_CHANNELS,
  type ChangesCount,
  type ChangesFileDiff,
  type ChangesHistory,
  type ChangesSummary
} from '../../shared/contracts';
import type { WorkspaceChangesService } from '../changes/workspace-changes-service';
import type { IpcAuthorizer, TargetAwareIpcEvent } from './ipc-access';

interface IpcRegistrar {
  handle(
    channel: string,
    handler: (event: TargetAwareIpcEvent, ...args: readonly unknown[]) => Promise<unknown> | unknown
  ): void;
}

interface RegisterChangesIpcDependencies {
  ipc: IpcRegistrar;
  authorize: IpcAuthorizer;
  service: Pick<
    WorkspaceChangesService,
    'summary' | 'fileDiff' | 'markReviewed' | 'history' | 'open' | 'counts'
  >;
}

class ChangesIpcError extends Error {
  readonly code = 'CHANGES_OPERATION_FAILED';

  constructor() {
    super('Lumora could not read workspace changes.');
    this.name = 'ChangesIpcError';
  }
}

/** Invalid requests and internal failures reach the renderer as one generic error. */
async function protectedOperation<T>(operation: () => Promise<T> | T): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new ChangesIpcError();
  }
}

export function registerChangesIpc({ ipc, authorize, service }: RegisterChangesIpcDependencies): void {
  ipc.handle(IPC_CHANNELS.changesSummaryGet, async (event, value): Promise<ChangesSummary> => {
    authorize(event);
    return protectedOperation(async () =>
      ChangesSummarySchema.parse(await service.summary(ChangesSourceSchema.parse(value)))
    );
  });

  ipc.handle(IPC_CHANNELS.changesFileDiffGet, async (event, value): Promise<ChangesFileDiff> => {
    authorize(event);
    return protectedOperation(async () => {
      const request = ChangesFileDiffRequestSchema.parse(value);
      return ChangesFileDiffSchema.parse(await service.fileDiff(request.source, request.path));
    });
  });

  ipc.handle(IPC_CHANNELS.changesReviewMark, async (event, value): Promise<ChangesSummary> => {
    authorize(event);
    return protectedOperation(async () => {
      const request = ChangesReviewRequestSchema.parse(value);
      return ChangesSummarySchema.parse(await service.markReviewed(request.ownerId, request.paths));
    });
  });

  ipc.handle(IPC_CHANNELS.changesHistoryGet, async (event, value): Promise<ChangesHistory> => {
    authorize(event);
    return protectedOperation(() => {
      const request = ChangesHistoryRequestSchema.parse(value);
      return ChangesHistorySchema.parse(service.history(request.workspaceId));
    });
  });

  ipc.handle(IPC_CHANNELS.changesFileOpen, async (event, value): Promise<null> => {
    authorize(event);
    return protectedOperation(async () => {
      const request = ChangesOpenRequestSchema.parse(value);
      await service.open(request.source, request.path, request.action);
      return null;
    });
  });

  ipc.handle(IPC_CHANNELS.changesCountsGet, async (event): Promise<ChangesCount[]> => {
    authorize(event);
    return protectedOperation(() => ChangesCountListSchema.parse(service.counts()));
  });
}
