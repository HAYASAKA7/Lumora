import { z } from 'zod';

export const PlatformSchema = z.enum(['win32', 'darwin', 'linux']);

export const SystemInfoSchema = z.strictObject({
  platform: PlatformSchema,
  arch: z.string().min(1),
  appVersion: z.string().min(1)
});

export type SystemInfo = z.infer<typeof SystemInfoSchema>;

export const IPC_CHANNELS = {
  systemInfo: 'lumora:system:info'
} as const;

export interface LumoraApi {
  getSystemInfo(): Promise<SystemInfo>;
}
