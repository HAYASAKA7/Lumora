import type {
  ProviderId,
  ProviderInstallation,
  SystemInfo
} from '../../shared/contracts';

type ReadyProviderInstallation = Extract<
  ProviderInstallation,
  { state: 'ready' }
>;

export interface VerifiedTransferRoute {
  provider: ProviderId;
  sourcePlatform: SystemInfo['platform'];
  destinationPlatform: SystemInfo['platform'];
  providerVersion: string;
  verifiedAt: string;
  lumoraCommit: string;
  evidenceId: string;
}

export interface TransferAdapterCapabilities {
  export: boolean;
  import: boolean;
}

export interface ProviderExportInput {
  installation: ReadyProviderInstallation;
  nativeSessionId: string;
  sourceKeys: readonly string[];
  expectedWorkspacePath: string;
  expectedTitle: string;
  stagingDirectory: string;
  signal?: AbortSignal;
}

export interface ProviderExportPayload {
  provider: ProviderId;
  nativeSessionId: string;
  workspacePath: string;
  title: string;
  payloadPath: string;
  size: number;
}

export interface ProviderImportInspectionInput {
  payloadPath: string;
}

export interface ProviderImportInspection {
  provider: ProviderId;
  nativeSessionId: string;
  workspacePath: string;
  title: string;
  payloadPath: string;
}

export interface ProviderImportInput {
  installation: ReadyProviderInstallation;
  inspection: ProviderImportInspection;
  destinationWorkspacePath: string;
  stagingDirectory: string;
  signal?: AbortSignal;
}

export type ProviderImportOutcome =
  | { status: 'duplicate'; nativeSessionId: string }
  | { status: 'imported'; nativeSessionId: string; payloadPath: string };

export interface ProviderImportVerificationInput {
  installation: ReadyProviderInstallation;
  nativeSessionId: string;
  workspacePath: string;
  title: string;
}

export interface ProviderImportRollbackInput {
  installation: ReadyProviderInstallation;
  nativeSessionId: string;
  workspacePath: string;
}

export interface ProviderTransferAdapter {
  readonly provider: ProviderId;
  capabilities(input: {
    sourcePlatform: SystemInfo['platform'];
    destinationPlatform: SystemInfo['platform'];
    providerVersion: string;
  }): TransferAdapterCapabilities;
  exportSession(input: ProviderExportInput): Promise<ProviderExportPayload>;
  inspectImport(
    input: ProviderImportInspectionInput
  ): Promise<ProviderImportInspection>;
  importSession(input: ProviderImportInput): Promise<ProviderImportOutcome>;
  verifyImportedSession(
    input: ProviderImportVerificationInput
  ): Promise<boolean>;
  rollbackImport(input: ProviderImportRollbackInput): Promise<void>;
}
