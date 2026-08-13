import {
  DiagnosticExportResultSchema,
  DiagnosticStorageSettingsSchema,
  DiagnosticSummarySchema,
  IPC_CHANNELS,
  type DiagnosticExportResult,
  type DiagnosticStorageSettings,
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
  storage: {
    getSettings(): Promise<DiagnosticStorageSettings>;
    selectJournalDirectory(directory: string): Promise<DiagnosticStorageSettings>;
    resetJournalDirectory(): Promise<DiagnosticStorageSettings>;
    selectExportDirectory(directory: string): Promise<DiagnosticStorageSettings>;
    resetExportDirectory(): Promise<DiagnosticStorageSettings>;
  };
  chooseDirectory(
    kind: 'journal' | 'export',
    currentDirectory: string
  ): Promise<string | null>;
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
  service,
  storage,
  chooseDirectory
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

  ipc.handle(
    IPC_CHANNELS.diagnosticStorageGet,
    async (event): Promise<DiagnosticStorageSettings> => {
      authorize(event);
      return protectedOperation(async () =>
        DiagnosticStorageSettingsSchema.parse(await storage.getSettings())
      );
    }
  );

  ipc.handle(
    IPC_CHANNELS.diagnosticJournalDirectoryChoose,
    async (event): Promise<DiagnosticStorageSettings> => {
      authorize(event);
      return protectedOperation(async () => {
        const current = await storage.getSettings();
        const directory = await chooseDirectory(
          'journal',
          current.effectiveJournalDirectory
        );
        return DiagnosticStorageSettingsSchema.parse(
          directory === null
            ? current
            : await storage.selectJournalDirectory(directory)
        );
      });
    }
  );

  ipc.handle(
    IPC_CHANNELS.diagnosticJournalDirectoryReset,
    async (event): Promise<DiagnosticStorageSettings> => {
      authorize(event);
      return protectedOperation(async () =>
        DiagnosticStorageSettingsSchema.parse(
          await storage.resetJournalDirectory()
        )
      );
    }
  );

  ipc.handle(
    IPC_CHANNELS.diagnosticExportDirectoryChoose,
    async (event): Promise<DiagnosticStorageSettings> => {
      authorize(event);
      return protectedOperation(async () => {
        const current = await storage.getSettings();
        const directory = await chooseDirectory(
          'export',
          current.effectiveExportDirectory
        );
        return DiagnosticStorageSettingsSchema.parse(
          directory === null
            ? current
            : await storage.selectExportDirectory(directory)
        );
      });
    }
  );

  ipc.handle(
    IPC_CHANNELS.diagnosticExportDirectoryReset,
    async (event): Promise<DiagnosticStorageSettings> => {
      authorize(event);
      return protectedOperation(async () =>
        DiagnosticStorageSettingsSchema.parse(
          await storage.resetExportDirectory()
        )
      );
    }
  );
}
