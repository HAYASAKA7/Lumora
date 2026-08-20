import {
  ApplicationAboutInfoSchema,
  ApplicationReleaseStatusSchema,
  ExternalOpenResultSchema,
  IPC_CHANNELS,
  type ApplicationReleaseStatus
} from '../../shared/contracts';
import type { IpcAuthorizer, TargetAwareIpcEvent } from './ipc-access';

const PROJECT_URL = 'https://github.com/HAYASAKA7/Lumora';

interface IpcRegistrar {
  handle(
    channel: string,
    handler: (event: TargetAwareIpcEvent, ...args: readonly unknown[]) => Promise<unknown> | unknown
  ): void;
}

export function registerAboutIpc({
  ipc,
  authorize,
  platform,
  arch,
  appVersion,
  release,
  openProject
}: {
  ipc: IpcRegistrar;
  authorize: IpcAuthorizer;
  platform: string;
  arch: string;
  appVersion: string;
  release: {
    getStatus(): Promise<ApplicationReleaseStatus>;
    openAvailableRelease(): Promise<unknown>;
  };
  openProject(url: string): Promise<unknown>;
}): void {
  const allowed = (event: TargetAwareIpcEvent) => authorize(event);
  ipc.handle(IPC_CHANNELS.applicationAboutGet, (event) => {
    allowed(event);
    return ApplicationAboutInfoSchema.parse({
      productName: 'Lumora',
      developer: 'HAYASAKA7',
      system: { platform, arch, appVersion }
    });
  });
  ipc.handle(IPC_CHANNELS.applicationReleaseStatusGet, async (event) => {
    allowed(event);
    return ApplicationReleaseStatusSchema.parse(await release.getStatus());
  });
  ipc.handle(IPC_CHANNELS.applicationProjectOpen, async (event) => {
    allowed(event);
    await openProject(PROJECT_URL);
    return ExternalOpenResultSchema.parse({ opened: true });
  });
  ipc.handle(IPC_CHANNELS.applicationReleaseOpen, async (event) => {
    allowed(event);
    return ExternalOpenResultSchema.parse(await release.openAvailableRelease());
  });
}
