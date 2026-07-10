import {
  IPC_CHANNELS,
  SystemInfoSchema,
  type SystemInfo
} from '../../shared/contracts';
import { isTrustedRendererUrl } from '../security-policy';

interface IpcInvokeEventLike {
  senderFrame: { url: string } | null;
}

interface IpcRegistrar {
  handle(
    channel: string,
    handler: (event: IpcInvokeEventLike) => Promise<unknown> | unknown
  ): void;
}

interface RegisterSystemIpcDependencies {
  ipc: IpcRegistrar;
  platform: string;
  arch: string;
  appVersion: string;
  developmentOrigin?: string;
}

class IpcAccessError extends Error {
  readonly code = 'IPC_UNTRUSTED_SENDER';

  constructor() {
    super('The IPC request did not originate from the Lumora renderer.');
    this.name = 'IpcAccessError';
  }
}

export function registerSystemIpc({
  ipc,
  platform,
  arch,
  appVersion,
  developmentOrigin
}: RegisterSystemIpcDependencies): void {
  ipc.handle(IPC_CHANNELS.systemInfo, async (event): Promise<SystemInfo> => {
    if (
      event.senderFrame === null ||
      !isTrustedRendererUrl(event.senderFrame.url, developmentOrigin)
    ) {
      throw new IpcAccessError();
    }

    return SystemInfoSchema.parse({ platform, arch, appVersion });
  });
}
