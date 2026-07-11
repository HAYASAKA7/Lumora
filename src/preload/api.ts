import {
  IPC_CHANNELS,
  ProviderScanResultSchema,
  SystemInfoSchema,
  type LumoraApi
} from '../shared/contracts';

type Invoke = (channel: string) => Promise<unknown>;

export function createLumoraApi(invoke: Invoke): LumoraApi {
  return Object.freeze({
    async getSystemInfo() {
      const value = await invoke(IPC_CHANNELS.systemInfo);
      return SystemInfoSchema.parse(value);
    },
    async scanProviders() {
      const value = await invoke(IPC_CHANNELS.providerScan);
      return ProviderScanResultSchema.parse(value);
    }
  });
}
