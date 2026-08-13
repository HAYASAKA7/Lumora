import {
  DiagnosticExportResultSchema,
  DiagnosticSummarySchema,
  IPC_CHANNELS,
  type DiagnosticExportResult,
  type DiagnosticSummary
} from '../../shared/contracts';
import type { DiagnosticService } from '../diagnostics/diagnostic-service';
import type { IpcAuthorizer, TargetAwareIpcEvent } from './ipc-access';

interface IpcRegistrar {
  handle(
    channel: string,
    handler: (event: TargetAwareIpcEvent) => Promise<unknown> | unknown
  ): void;
}

interface RegisterDiagnosticIpcDependencies {
  ipc: IpcRegistrar;
  authorize: IpcAuthorizer;
  service: Pick<DiagnosticService, 'getSummary' | 'exportBundle'>;
}

class DiagnosticIpcError extends Error {
  readonly code = 'DIAGNOSTIC_OPERATION_FAILED';

  constructor() {
    super('Lumora could not complete the diagnostic operation.');
    this.name = 'DiagnosticIpcError';
  }
}

async function protectedOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new DiagnosticIpcError();
  }
}

export function registerDiagnosticIpc({
  ipc,
  authorize,
  service
}: RegisterDiagnosticIpcDependencies): void {
  ipc.handle(
    IPC_CHANNELS.diagnosticSummaryGet,
    async (event): Promise<DiagnosticSummary> => {
      authorize(event);
      return protectedOperation(async () =>
        DiagnosticSummarySchema.parse(await service.getSummary())
      );
    }
  );

  ipc.handle(
    IPC_CHANNELS.diagnosticBundleExport,
    async (event): Promise<DiagnosticExportResult> => {
      authorize(event);
      return protectedOperation(async () =>
        DiagnosticExportResultSchema.parse(await service.exportBundle())
      );
    }
  );
}
