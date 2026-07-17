import {
  CatalogQuerySchema,
  CatalogSnapshotSchema,
  ClipboardTextSchema,
  ClipboardWriteResultSchema,
  CustomTerminalProfileInputSchema,
  DeveloperEnvironmentScanResultSchema,
  ExternalOpenResultSchema,
  IPC_CHANNELS,
  KeyboardSettingsSchema,
  LaunchPrepareRequestSchema,
  LaunchPreviewSchema,
  LaunchSettingsLayerInputSchema,
  LaunchSettingsLayerListSchema,
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
  SystemInfoSchema,
  TerminalProfileIdSchema,
  TerminalProfileListSchema,
  WorkspaceTrustDecisionListSchema,
  WorkspaceTrustDecisionSchema,
  WorkspaceTrustGrantRequestSchema,
  WorkspaceTrustRevokeRequestSchema,
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
  const api: LumoraApi = {
    async getSystemInfo() {
      const value = await invoke(IPC_CHANNELS.systemInfo);
      return SystemInfoSchema.parse(value);
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
    async readClipboardText() {
      const value = await invoke(IPC_CHANNELS.clipboardTextRead);
      return ClipboardTextSchema.parse(value);
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
    onRuntimeEvent(listener) {
      return subscribe(IPC_CHANNELS.runtimeEvent, (value) => {
        listener(RuntimeEventSchema.parse(value));
      });
    }
  };
  return Object.freeze(api);
}
