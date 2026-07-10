import {
  IPC_CHANNELS,
  SystemInfoSchema,
  type LumoraApi
} from '../shared/contracts';

type Invoke = (channel: string) => Promise<unknown>;

export function createLumoraApi(invoke: Invoke): LumoraApi {
  return Object.freeze({
    async getSystemInfo() {
      const value = await invoke(IPC_CHANNELS.systemInfo);
      return SystemInfoSchema.parse(value);
    }
  });
}
