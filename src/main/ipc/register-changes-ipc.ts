import {
  ChangesCountListSchema,
  ChangesFileDiffRequestSchema,
  ChangesFileDiffSchema,
  ChangesHistoryRequestSchema,
  ChangesHistorySchema,
  ChangesFilePathRequestSchema,
  ChangesFilePathSchema,
  ChangesOpenOutcomeSchema,
  ChangesOpenRequestSchema,
  ChangesReviewRequestSchema,
  ChangesSourceSchema,
  ChangesSummarySchema,
  IPC_CHANNELS,
  type ChangesCount,
  type ChangesFileDiff,
  type ChangesFilePath,
  type ChangesHistory,
  type ChangesOpenOutcome,
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
  /** Null where this computer has no change tracking; every request then fails alike. */
  service: ChangesIpcService | null;
}

type ChangesIpcService = Pick<
  WorkspaceChangesService,
  'summary' | 'fileDiff' | 'markReviewed' | 'history' | 'filePath' | 'open' | 'counts'
>;

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

function unavailable(): never {
  throw new ChangesIpcError();
}

/** Answers as a broken workspace would, so the renderer needs no second failure path. */
const NO_CHANGE_TRACKING: ChangesIpcService = {
  summary: unavailable,
  fileDiff: unavailable,
  markReviewed: unavailable,
  history: unavailable,
  filePath: unavailable,
  open: unavailable,
  counts: () => []
};

export function registerChangesIpc({
  ipc,
  authorize,
  service: tracking
}: RegisterChangesIpcDependencies): void {
  const service = tracking ?? NO_CHANGE_TRACKING;
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

  ipc.handle(IPC_CHANNELS.changesFilePathGet, async (event, value): Promise<ChangesFilePath> => {
    authorize(event);
    return protectedOperation(async () => {
      const request = ChangesFilePathRequestSchema.parse(value);
      return ChangesFilePathSchema.parse({ path: await service.filePath(request.source, request.path) });
    });
  });

  ipc.handle(IPC_CHANNELS.changesFileOpen, async (event, value): Promise<ChangesOpenOutcome> => {
    authorize(event);
    return protectedOperation(async () => {
      const request = ChangesOpenRequestSchema.parse(value);
      return ChangesOpenOutcomeSchema.parse(await service.open(request.source, request.path, request.action));
    });
  });

  ipc.handle(IPC_CHANNELS.changesCountsGet, async (event): Promise<ChangesCount[]> => {
    authorize(event);
    return protectedOperation(() => ChangesCountListSchema.parse(service.counts()));
  });
}
