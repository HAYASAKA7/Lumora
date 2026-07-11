import {
  CatalogQuerySchema,
  CatalogSnapshotSchema,
  IPC_CHANNELS,
  ProviderScanResultSchema,
  SystemInfoSchema,
  type CatalogQuery,
  type LumoraApi
} from '../shared/contracts';

type Invoke = (channel: string, ...args: readonly unknown[]) => Promise<unknown>;

const EMPTY_CATALOG_QUERY = { text: '', provider: null } as const;

export function createLumoraApi(invoke: Invoke): LumoraApi {
  return Object.freeze({
    async getSystemInfo() {
      const value = await invoke(IPC_CHANNELS.systemInfo);
      return SystemInfoSchema.parse(value);
    },
    async scanProviders() {
      const value = await invoke(IPC_CHANNELS.providerScan);
      return ProviderScanResultSchema.parse(value);
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
    }
  });
}
