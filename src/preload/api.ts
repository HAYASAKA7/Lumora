import {
  ApplicationAboutInfoSchema,
  ApplicationReleaseStatusSchema,
  ApplicationQuitRequestSchema,
  ApplicationQuitResolutionSchema,
  ApplicationQuitResultSchema,
  AppearanceBackgroundStateSchema,
  AppearancePresentationSchema,
  CatalogQuerySchema,
  CatalogSnapshotSchema,
  ClipboardTextSchema,
  ClipboardWriteResultSchema,
  TerminalClipboardReadRequestSchema,
  TerminalClipboardReadResultSchema,
  CustomTerminalProfileInputSchema,
  DeveloperEnvironmentScanResultSchema,
  DiagnosticExportResultSchema,
  DiagnosticStorageSettingsSchema,
  DiagnosticSummarySchema,
  ExternalOpenResultSchema,
  FontPresetListSchema,
  ThemePresetListSchema,
  GeneralSettingsChangedSchema,
  GeneralSettingsSchema,
  IPC_CHANNELS,
  KeyboardSettingsSchema,
  LaunchPrepareRequestSchema,
  LaunchPreviewSchema,
  LaunchSettingsLayerInputSchema,
  LaunchSettingsLayerListSchema,
  LocaleReloadResultSchema,
  LocalizationFolderOpenResultSchema,
  LocalizationSnapshotSchema,
  ModsRootChooseResultSchema,
  ModsSettingsSchema,
  LumoraWindowContextSchema,
  ProviderLaunchConfigInputSchema,
  ProviderLaunchConfigListSchema,
  ProviderScanResultSchema,
  ProviderUpdateCheckResultSchema,
  ProviderUpdateRequestSchema,
  ProviderUpdateResultSchema,
  RuntimeAttachmentSchema,
  RuntimeCommandResultSchema,
  RuntimeEventSchema,
  RuntimeIdRequestSchema,
  RuntimeListSchema,
  RuntimeResizeRequestSchema,
  RuntimeStartRequestSchema,
  RuntimeSummarySchema,
  RuntimeWriteRequestSchema,
  RemoteConnectionProfileInputSchema,
  RemoteAutoConnectPreferenceRequestSchema,
  RemoteCredentialStatusSchema,
  RemoteHostKeyObservationSchema,
  RemoteHostTrustRequestSchema,
  RemoteHelperInstallDetailsSchema,
  RemoteLifecycleEventSchema,
  RemoteLifecycleListSchema,
  RemoteWindowCloseRequestSchema,
  RemoteWindowCloseResolutionSchema,
  RemoteWindowCloseResultSchema,
  RemoteDiscoverySnapshotSchema,
  RemoteSessionCatalogSchema,
  RemoteProviderPreferencesSchema,
  RemoteTargetConnectRequestSchema,
  RemoteTargetConnectionDetailsSchema,
  RemoteTargetIdRequestSchema,
  RemoteTargetListSchema,
  RemoteTargetRemovalResultSchema,
  RemoteTargetSummarySchema,
  RemoteTargetUpdateRequestSchema,
  RemoteTargetWindowOpenResultSchema,
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
  SessionTransferProgressEventSchema,
  SessionTransferResultSchema,
  TransferHistoryListSchema,
  TransferOperationCancelRequestSchema,
  TransferOperationCancelResultSchema,
  StartupPresentationClaimSchema,
  StartupPresentationCompletionSchema,
  SystemInfoSchema,
  TerminalProfileIdSchema,
  TerminalProfileListSchema,
  TerminalLinkOpenRequestSchema,
  TrayResumeSessionRequestSchema,
  WorkspaceSummarySchema,
  WorkspaceTrustDecisionListSchema,
  WorkspaceTrustDecisionSchema,
  WorkspaceTrustGrantRequestSchema,
  WorkspaceTrustRevokeRequestSchema,
  WorkspaceVisibilityPolicyListSchema,
  WorkspaceVisibilityRestoreRequestSchema,
  WorkspaceVisibilitySetRequestSchema,
  type CatalogQuery,
  type LumoraApi
} from '../shared/contracts';

type Invoke = (channel: string, ...args: readonly unknown[]) => Promise<unknown>;
type Subscribe = (
  channel: string,
  listener: (value: unknown) => void
) => () => void;

const EMPTY_CATALOG_QUERY = { text: '', provider: null } as const;

export function createLumoraApi(
  invoke: Invoke,
  subscribe: Subscribe = () => () => undefined
): LumoraApi {
  let startupPresentationClaim: Promise<boolean> | null = null;
  const api: LumoraApi = {
    async getLocalizationSnapshot() {
      const value = await invoke(IPC_CHANNELS.localizationSnapshotGet);
      return LocalizationSnapshotSchema.parse(value);
    },
    async reloadLocalization() {
      const value = await invoke(IPC_CHANNELS.localizationReload);
      return LocaleReloadResultSchema.parse(value);
    },
    async openUserLocaleFolder() {
      const value = await invoke(IPC_CHANNELS.localizationUserFolderOpen);
      LocalizationFolderOpenResultSchema.parse(value);
    },
    async getModsSettings() {
      const value = await invoke(IPC_CHANNELS.modsSettingsGet);
      return ModsSettingsSchema.parse(value);
    },
    async chooseModsRoot() {
      const value = await invoke(IPC_CHANNELS.modsRootChoose);
      return ModsRootChooseResultSchema.parse(value);
    },
    async resetModsRoot() {
      const value = await invoke(IPC_CHANNELS.modsRootReset);
      return ModsSettingsSchema.parse(value);
    },
    async openModsRoot() {
      const value = await invoke(IPC_CHANNELS.modsRootOpen);
      LocalizationFolderOpenResultSchema.parse(value);
    },
    async getFontPresets() {
      const value = await invoke(IPC_CHANNELS.fontPresetsGet);
      return FontPresetListSchema.parse(value);
    },
    async openFontPresetFolder() {
      const value = await invoke(IPC_CHANNELS.fontPresetFolderOpen);
      LocalizationFolderOpenResultSchema.parse(value);
    },
    async getThemePresets() {
      const value = await invoke(IPC_CHANNELS.themePresetsGet);
      return ThemePresetListSchema.parse(value);
    },
    async openThemePresetFolder() {
      const value = await invoke(IPC_CHANNELS.themePresetFolderOpen);
      LocalizationFolderOpenResultSchema.parse(value);
    },
    onLocalizationChanged(listener) {
      return subscribe(IPC_CHANNELS.localizationChanged, (value) => {
        listener(LocalizationSnapshotSchema.parse(value));
      });
    },
    onApplicationQuitRequest(listener) {
      return subscribe(IPC_CHANNELS.applicationQuitRequest, (value) => {
        listener(ApplicationQuitRequestSchema.parse(value));
      });
    },
    async resolveApplicationQuit(resolution) {
      const request = ApplicationQuitResolutionSchema.parse(resolution);
      const value = await invoke(IPC_CHANNELS.applicationQuitResolve, request);
      return ApplicationQuitResultSchema.parse(value).accepted;
    },
    async getWindowContext() {
      const value = await invoke(IPC_CHANNELS.targetWindowContextGet);
      return LumoraWindowContextSchema.parse(value);
    },
    async listRemoteTargets() {
      const value = await invoke(IPC_CHANNELS.remoteTargetList);
      return RemoteTargetListSchema.parse(value);
    },
    async listRemoteLifecycleSnapshots() {
      const value = await invoke(IPC_CHANNELS.remoteLifecycleList);
      return RemoteLifecycleListSchema.parse(value);
    },
    onRemoteLifecycleEvent(listener) {
      return subscribe(IPC_CHANNELS.remoteLifecycleEvent, (value) => {
        listener(RemoteLifecycleEventSchema.parse(value));
      });
    },
    onRemoteWindowCloseRequest(listener) {
      return subscribe(IPC_CHANNELS.remoteWindowCloseRequest, (value) => {
        listener(RemoteWindowCloseRequestSchema.parse(value));
      });
    },
    async resolveRemoteWindowClose(resolution) {
      const request = RemoteWindowCloseResolutionSchema.parse(resolution);
      const value = await invoke(
        IPC_CHANNELS.remoteWindowCloseResolve,
        request
      );
      return RemoteWindowCloseResultSchema.parse(value).closed;
    },
    async createRemoteTarget(input) {
      const request = RemoteConnectionProfileInputSchema.parse(input);
      const value = await invoke(IPC_CHANNELS.remoteTargetCreate, request);
      return RemoteTargetSummarySchema.parse(value);
    },
    async updateRemoteTarget(executionTargetId, input) {
      const request = RemoteTargetUpdateRequestSchema.parse({
        executionTargetId,
        profile: input
      });
      const value = await invoke(IPC_CHANNELS.remoteTargetUpdate, request);
      return RemoteTargetSummarySchema.parse(value);
    },
    async removeRemoteTarget(executionTargetId) {
      const request = RemoteTargetIdRequestSchema.parse({ executionTargetId });
      const value = await invoke(IPC_CHANNELS.remoteTargetRemove, request);
      RemoteTargetRemovalResultSchema.parse(value);
    },
    async observeRemoteHost(executionTargetId) {
      const request = RemoteTargetIdRequestSchema.parse({ executionTargetId });
      const value = await invoke(IPC_CHANNELS.remoteTargetObserveHost, request);
      return RemoteHostKeyObservationSchema.parse(value);
    },
    async trustRemoteHost(input) {
      const request = RemoteHostTrustRequestSchema.parse(input);
      const value = await invoke(IPC_CHANNELS.remoteTargetTrustHost, request);
      return RemoteTargetSummarySchema.parse(value);
    },
    async connectRemoteTarget(input) {
      const request = RemoteTargetConnectRequestSchema.parse(input);
      const value = await invoke(IPC_CHANNELS.remoteTargetConnect, request);
      return RemoteTargetConnectionDetailsSchema.parse(value);
    },
    async getRemoteCredentialStatus(executionTargetId) {
      const request = RemoteTargetIdRequestSchema.parse({ executionTargetId });
      const value = await invoke(
        IPC_CHANNELS.remoteCredentialStatus,
        request
      );
      return RemoteCredentialStatusSchema.parse(value);
    },
    async setRemoteAutoConnect(executionTargetId, enabled) {
      const request = RemoteAutoConnectPreferenceRequestSchema.parse({
        executionTargetId,
        autoConnect: enabled
      });
      const value = await invoke(
        IPC_CHANNELS.remoteAutoConnectPreferenceSave,
        request
      );
      return RemoteCredentialStatusSchema.parse(value);
    },
    async forgetRemoteCredential(executionTargetId) {
      const request = RemoteTargetIdRequestSchema.parse({ executionTargetId });
      const value = await invoke(
        IPC_CHANNELS.remoteCredentialForget,
        request
      );
      return RemoteCredentialStatusSchema.parse(value);
    },
    async disconnectRemoteTarget(executionTargetId) {
      const request = RemoteTargetIdRequestSchema.parse({ executionTargetId });
      const value = await invoke(IPC_CHANNELS.remoteTargetDisconnect, request);
      return RemoteTargetSummarySchema.parse(value);
    },
    async getRemoteHelperInstallDetails() {
      const value = await invoke(IPC_CHANNELS.remoteTargetHelperDetails);
      return RemoteHelperInstallDetailsSchema.parse(value);
    },
    async installRemoteHelper() {
      const value = await invoke(IPC_CHANNELS.remoteTargetHelperInstall);
      return RemoteTargetConnectionDetailsSchema.parse(value);
    },
    async getRemoteProviderPreferences() {
      const value = await invoke(IPC_CHANNELS.remoteProviderPreferencesGet);
      return RemoteProviderPreferencesSchema.parse(value);
    },
    async saveRemoteProviderPreferences(preferences) {
      const request = RemoteProviderPreferencesSchema.parse(preferences);
      const value = await invoke(
        IPC_CHANNELS.remoteProviderPreferencesSave,
        request
      );
      return RemoteProviderPreferencesSchema.parse(value);
    },
    async scanRemoteDiscovery() {
      const value = await invoke(IPC_CHANNELS.remoteDiscoveryScan);
      return RemoteDiscoverySnapshotSchema.parse(value);
    },
    async scanRemoteSessions() {
      const value = await invoke(IPC_CHANNELS.remoteSessionScan);
      return RemoteSessionCatalogSchema.parse(value);
    },
    async openRemoteTargetWindow(executionTargetId) {
      const request = RemoteTargetIdRequestSchema.parse({ executionTargetId });
      const value = await invoke(IPC_CHANNELS.remoteTargetWindowOpen, request);
      RemoteTargetWindowOpenResultSchema.parse(value);
    },
    async getAppearancePresentation() {
      const value = await invoke(IPC_CHANNELS.appearancePresentationGet);
      return AppearancePresentationSchema.parse(value);
    },
    async getDiagnosticSummary() {
      const value = await invoke(IPC_CHANNELS.diagnosticSummaryGet);
      return DiagnosticSummarySchema.parse(value);
    },
    async exportDiagnosticBundle() {
      const value = await invoke(IPC_CHANNELS.diagnosticBundleExport);
      return DiagnosticExportResultSchema.parse(value);
    },
    async getDiagnosticStorageSettings() {
      const value = await invoke(IPC_CHANNELS.diagnosticStorageGet);
      return DiagnosticStorageSettingsSchema.parse(value);
    },
    async chooseDiagnosticJournalDirectory() {
      const value = await invoke(IPC_CHANNELS.diagnosticJournalDirectoryChoose);
      return DiagnosticStorageSettingsSchema.parse(value);
    },
    async resetDiagnosticJournalDirectory() {
      const value = await invoke(IPC_CHANNELS.diagnosticJournalDirectoryReset);
      return DiagnosticStorageSettingsSchema.parse(value);
    },
    async chooseDiagnosticExportDirectory() {
      const value = await invoke(IPC_CHANNELS.diagnosticExportDirectoryChoose);
      return DiagnosticStorageSettingsSchema.parse(value);
    },
    async resetDiagnosticExportDirectory() {
      const value = await invoke(IPC_CHANNELS.diagnosticExportDirectoryReset);
      return DiagnosticStorageSettingsSchema.parse(value);
    },
    async claimStartupPresentation() {
      startupPresentationClaim ??= invoke(
        IPC_CHANNELS.startupPresentationClaim
      ).then((value) => StartupPresentationClaimSchema.parse(value));
      return startupPresentationClaim;
    },
    async completeStartupPresentation() {
      const value = await invoke(
        IPC_CHANNELS.startupPresentationComplete
      );
      StartupPresentationCompletionSchema.parse(value);
    },
    async getSystemInfo() {
      const value = await invoke(IPC_CHANNELS.systemInfo);
      return SystemInfoSchema.parse(value);
    },
    async getApplicationAboutInfo() {
      const value = await invoke(IPC_CHANNELS.applicationAboutGet);
      return ApplicationAboutInfoSchema.parse(value);
    },
    async getApplicationReleaseStatus() {
      const value = await invoke(IPC_CHANNELS.applicationReleaseStatusGet);
      return ApplicationReleaseStatusSchema.parse(value);
    },
    async openLumoraProjectPage() {
      const value = await invoke(IPC_CHANNELS.applicationProjectOpen);
      return ExternalOpenResultSchema.parse(value);
    },
    async openApplicationReleasePage() {
      const value = await invoke(IPC_CHANNELS.applicationReleaseOpen);
      return ExternalOpenResultSchema.parse(value);
    },
    async scanDeveloperEnvironment() {
      const value = await invoke(IPC_CHANNELS.environmentScan);
      return DeveloperEnvironmentScanResultSchema.parse(value);
    },
    async openNodeDownloadPage() {
      const value = await invoke(IPC_CHANNELS.nodeDownloadOpen);
      ExternalOpenResultSchema.parse(value);
    },
    async scanProviders() {
      const value = await invoke(IPC_CHANNELS.providerScan);
      return ProviderScanResultSchema.parse(value);
    },
    async checkProviderUpdates() {
      const value = await invoke(IPC_CHANNELS.providerUpdatesCheck);
      return ProviderUpdateCheckResultSchema.parse(value);
    },
    async installProvider(provider) {
      const request = ProviderUpdateRequestSchema.parse({ provider });
      const value = await invoke(IPC_CHANNELS.providerInstallRun, request);
      return ProviderUpdateResultSchema.parse(value);
    },
    async openProviderInstallGuide(provider) {
      const request = ProviderUpdateRequestSchema.parse({ provider });
      const value = await invoke(
        IPC_CHANNELS.providerInstallGuideOpen,
        request
      );
      ExternalOpenResultSchema.parse(value);
    },
    async updateProvider(provider) {
      const request = ProviderUpdateRequestSchema.parse({ provider });
      const value = await invoke(IPC_CHANNELS.providerUpdateRun, request);
      return ProviderUpdateResultSchema.parse(value);
    },
    async getCatalog(query?: CatalogQuery) {
      const request = CatalogQuerySchema.parse(query ?? EMPTY_CATALOG_QUERY);
      const value = await invoke(IPC_CHANNELS.catalogGet, request);
      return CatalogSnapshotSchema.parse(value);
    },
    async refreshCatalog(query?: CatalogQuery) {
      const request = CatalogQuerySchema.parse(query ?? EMPTY_CATALOG_QUERY);
      const value = await invoke(IPC_CHANNELS.catalogRefresh, request);
      return CatalogSnapshotSchema.parse(value);
    },
    async chooseWorkspace() {
      const value = await invoke(IPC_CHANNELS.workspaceChoose);
      return value === null ? null : CatalogSnapshotSchema.parse(value);
    },
    async getWorkspaceVisibilityPolicies() {
      const value = await invoke(IPC_CHANNELS.workspaceVisibilityGet);
      return WorkspaceVisibilityPolicyListSchema.parse(value);
    },
    async setWorkspaceVisibilityPolicy(input) {
      const request = WorkspaceVisibilitySetRequestSchema.parse(input);
      const value = await invoke(IPC_CHANNELS.workspaceVisibilitySet, request);
      return WorkspaceVisibilityPolicyListSchema.parse(value);
    },
    async restoreWorkspaceVisibility(input) {
      const request = WorkspaceVisibilityRestoreRequestSchema.parse(input);
      const value = await invoke(
        IPC_CHANNELS.workspaceVisibilityRestore,
        request
      );
      return WorkspaceVisibilityPolicyListSchema.parse(value);
    },
    async restoreAllWorkspaceVisibility() {
      const value = await invoke(IPC_CHANNELS.workspaceVisibilityRestoreAll);
      return WorkspaceVisibilityPolicyListSchema.parse(value);
    },
    onTrayResumeSessionRequested(listener) {
      return subscribe(IPC_CHANNELS.trayResumeSession, (value) => {
        listener(TrayResumeSessionRequestSchema.parse(value).sessionId);
      });
    },
    async readClipboardText() {
      const value = await invoke(IPC_CHANNELS.clipboardTextRead);
      return ClipboardTextSchema.parse(value);
    },
    async readTerminalClipboard(runtimeId) {
      const request = TerminalClipboardReadRequestSchema.parse({ runtimeId });
      const value = await invoke(IPC_CHANNELS.terminalClipboardRead, request);
      return TerminalClipboardReadResultSchema.parse(value);
    },
    async writeClipboardText(text) {
      const request = ClipboardTextSchema.parse(text);
      const value = await invoke(IPC_CHANNELS.clipboardTextWrite, request);
      ClipboardWriteResultSchema.parse(value);
    },
    async getTerminalProfiles() {
      const value = await invoke(IPC_CHANNELS.terminalProfilesGet);
      return TerminalProfileListSchema.parse(value);
    },
    async saveTerminalProfile(input) {
      const request = CustomTerminalProfileInputSchema.parse(input);
      const value = await invoke(IPC_CHANNELS.terminalProfileSave, request);
      return TerminalProfileListSchema.parse(value);
    },
    async deleteTerminalProfile(profileId) {
      const request = TerminalProfileIdSchema.parse(profileId);
      const value = await invoke(IPC_CHANNELS.terminalProfileDelete, request);
      return TerminalProfileListSchema.parse(value);
    },
    async getProviderLaunchConfigs() {
      const value = await invoke(IPC_CHANNELS.providerLaunchConfigsGet);
      return ProviderLaunchConfigListSchema.parse(value);
    },
    async saveProviderLaunchConfig(input) {
      const request = ProviderLaunchConfigInputSchema.parse(input);
      const value = await invoke(
        IPC_CHANNELS.providerLaunchConfigSave,
        request
      );
      return ProviderLaunchConfigListSchema.parse(value);
    },
    async getLaunchSettingsLayers() {
      const value = await invoke(IPC_CHANNELS.launchSettingsLayersGet);
      return LaunchSettingsLayerListSchema.parse(value);
    },
    async saveLaunchSettingsLayer(input) {
      const request = LaunchSettingsLayerInputSchema.parse(input);
      const value = await invoke(
        IPC_CHANNELS.launchSettingsLayerSave,
        request
      );
      return LaunchSettingsLayerListSchema.parse(value);
    },
    async getGeneralSettings() {
      const value = await invoke(IPC_CHANNELS.generalSettingsGet);
      return GeneralSettingsSchema.parse(value);
    },
    async saveGeneralSettings(input) {
      const request = GeneralSettingsSchema.parse(input);
      const value = await invoke(IPC_CHANNELS.generalSettingsSave, request);
      return GeneralSettingsSchema.parse(value);
    },
    onGeneralSettingsChanged(listener) {
      return subscribe(IPC_CHANNELS.generalSettingsChanged, (value) => {
        GeneralSettingsChangedSchema.parse(value);
        listener();
      });
    },
    async getAppearanceBackground() {
      const value = await invoke(IPC_CHANNELS.appearanceBackgroundGet);
      return AppearanceBackgroundStateSchema.parse(value);
    },
    async chooseAppearanceBackground() {
      const value = await invoke(IPC_CHANNELS.appearanceBackgroundChoose);
      return AppearanceBackgroundStateSchema.parse(value);
    },
    async removeAppearanceBackground() {
      const value = await invoke(IPC_CHANNELS.appearanceBackgroundRemove);
      return AppearanceBackgroundStateSchema.parse(value);
    },
    async getKeyboardSettings() {
      const value = await invoke(IPC_CHANNELS.keyboardSettingsGet);
      return KeyboardSettingsSchema.parse(value);
    },
    async saveKeyboardSettings(input) {
      const request = KeyboardSettingsSchema.parse(input);
      const value = await invoke(IPC_CHANNELS.keyboardSettingsSave, request);
      return KeyboardSettingsSchema.parse(value);
    },
    async prepareLaunch(input) {
      const request = LaunchPrepareRequestSchema.parse(input);
      const value = await invoke(IPC_CHANNELS.launchPrepare, request);
      return LaunchPreviewSchema.parse(value);
    },
    async getWorkspaceTrustDecisions() {
      const value = await invoke(IPC_CHANNELS.workspaceTrustGet);
      return WorkspaceTrustDecisionListSchema.parse(value);
    },
    async trustWorkspaceForLaunch(launchToken) {
      const request = WorkspaceTrustGrantRequestSchema.parse({ launchToken });
      const value = await invoke(IPC_CHANNELS.workspaceTrustGrant, request);
      return WorkspaceTrustDecisionSchema.parse(value);
    },
    async revokeWorkspaceTrust(workspaceId) {
      const request = WorkspaceTrustRevokeRequestSchema.parse({ workspaceId });
      const value = await invoke(IPC_CHANNELS.workspaceTrustRevoke, request);
      return WorkspaceTrustDecisionListSchema.parse(value);
    },
    async startRuntime(launchToken) {
      const request = RuntimeStartRequestSchema.parse({ launchToken });
      const value = await invoke(IPC_CHANNELS.runtimeStart, request);
      return RuntimeSummarySchema.parse(value);
    },
    async listRuntimes() {
      const value = await invoke(IPC_CHANNELS.runtimeList);
      return RuntimeListSchema.parse(value);
    },
    async attachRuntime(runtimeId) {
      const request = RuntimeIdRequestSchema.parse({ runtimeId });
      const value = await invoke(IPC_CHANNELS.runtimeAttach, request);
      return RuntimeAttachmentSchema.parse(value);
    },
    async writeRuntime(input) {
      const request = RuntimeWriteRequestSchema.parse(input);
      const value = await invoke(IPC_CHANNELS.runtimeWrite, request);
      RuntimeCommandResultSchema.parse(value);
    },
    async resizeRuntime(input) {
      const request = RuntimeResizeRequestSchema.parse(input);
      const value = await invoke(IPC_CHANNELS.runtimeResize, request);
      RuntimeCommandResultSchema.parse(value);
    },
    async terminateRuntime(runtimeId) {
      const request = RuntimeIdRequestSchema.parse({ runtimeId });
      const value = await invoke(IPC_CHANNELS.runtimeTerminate, request);
      return RuntimeSummarySchema.parse(value);
    },
    async openTerminalLink(url) {
      const request = TerminalLinkOpenRequestSchema.parse({ url });
      const value = await invoke(IPC_CHANNELS.terminalLinkOpen, request);
      ExternalOpenResultSchema.parse(value);
    },
    onRuntimeEvent(listener) {
      return subscribe(IPC_CHANNELS.runtimeEvent, (value) => {
        listener(RuntimeEventSchema.parse(value));
      });
    },
    async getTransferCapabilities() {
      const value = await invoke(IPC_CHANNELS.transferCapabilitiesGet);
      return SessionTransferCapabilityListSchema.parse(value);
    },
    async prepareSessionExport(input) {
      const request = SessionExportPrepareRequestSchema.parse(input);
      const value = await invoke(IPC_CHANNELS.transferExportPrepare, request);
      return SessionExportPlanSchema.parse(value);
    },
    async executeSessionExport(input) {
      const request = SessionExportExecuteRequestSchema.parse(input);
      const value = await invoke(IPC_CHANNELS.transferExportExecute, request);
      return value === null ? null : SessionTransferResultSchema.parse(value);
    },
    async chooseSessionImportArchive() {
      const value = await invoke(IPC_CHANNELS.transferImportChoose);
      return value === null
        ? null
        : SessionTransferArchiveSelectionSchema.parse(value);
    },
    async inspectSessionImport(input) {
      const request = SessionImportInspectRequestSchema.parse(input);
      const value = await invoke(IPC_CHANNELS.transferImportInspect, request);
      return SessionImportInspectionSchema.parse(value);
    },
    async planSessionImport(input) {
      const request = SessionImportPlanRequestSchema.parse(input);
      const value = await invoke(IPC_CHANNELS.transferImportPlan, request);
      return SessionImportPlanSchema.parse(value);
    },
    async executeSessionImport(input) {
      const request = SessionImportExecuteRequestSchema.parse(input);
      const value = await invoke(IPC_CHANNELS.transferImportExecute, request);
      return SessionTransferResultSchema.parse(value);
    },
    async chooseTransferWorkspace() {
      const value = await invoke(IPC_CHANNELS.transferWorkspaceChoose);
      return value === null ? null : WorkspaceSummarySchema.parse(value);
    },
    async getTransferHistory() {
      const value = await invoke(IPC_CHANNELS.transferHistoryGet);
      return TransferHistoryListSchema.parse(value);
    },
    async cancelTransferOperation(operationId) {
      const request = TransferOperationCancelRequestSchema.parse({
        operationId
      });
      const value = await invoke(IPC_CHANNELS.transferOperationCancel, request);
      TransferOperationCancelResultSchema.parse(value);
    },
    onTransferEvent(listener) {
      return subscribe(IPC_CHANNELS.transferEvent, (value) => {
        listener(SessionTransferProgressEventSchema.parse(value));
      });
    }
  };
  return Object.freeze(api);
}
