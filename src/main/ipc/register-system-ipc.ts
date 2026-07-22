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
  claimStartupPresentation(): Promise<boolean>;
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
  claimStartupPresentation,
  developmentOrigin
}: RegisterSystemIpcDependencies): void {
  const assertTrustedRenderer = (event: IpcInvokeEventLike): void => {
    if (
      event.senderFrame === null ||
      !isTrustedRendererUrl(event.senderFrame.url, developmentOrigin)
    ) {
      throw new IpcAccessError();
    }
  };

  ipc.handle(IPC_CHANNELS.systemInfo, async (event): Promise<SystemInfo> => {
    assertTrustedRenderer(event);

    return SystemInfoSchema.parse({ platform, arch, appVersion });
  });
  ipc.handle(IPC_CHANNELS.startupPresentationClaim, async (event) => {
    assertTrustedRenderer(event);
    return claimStartupPresentation();
  });
}
