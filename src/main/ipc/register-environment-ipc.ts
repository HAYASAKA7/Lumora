import type { IpcAuthorizer } from './ipc-access';
import {
  DeveloperEnvironmentScanResultSchema,
  ExternalOpenResultSchema,
  IPC_CHANNELS,
  type DeveloperEnvironmentScanResult,
  type LumoraWindowContext
} from '../../shared/contracts';
import { isTrustedRendererUrl } from '../security-policy';

export const NODE_DOWNLOAD_URL = 'https://nodejs.org/en/download';

interface IpcInvokeEventLike {
  senderFrame: { url: string } | null;
}

interface IpcRegistrar {
  handle(
    channel: string,
    handler: (
      event: IpcInvokeEventLike,
      ...args: readonly unknown[]
    ) => Promise<unknown> | unknown
  ): void;
}

interface EnvironmentScanner {
  scan(): Promise<DeveloperEnvironmentScanResult>;
}

interface RegisterEnvironmentIpcDependencies {
  ipc: IpcRegistrar;
  authorize: IpcAuthorizer;
  resolveScanner(context: LumoraWindowContext): EnvironmentScanner;
  openExternal(url: string): Promise<void>;
  developmentOrigin?: string;
}

class IpcAccessError extends Error {
  readonly code = 'IPC_UNTRUSTED_SENDER';

  constructor() {
    super('The IPC request did not originate from the Lumora renderer.');
    this.name = 'IpcAccessError';
  }
}

function assertTrusted(
  event: IpcInvokeEventLike,
  authorize: IpcAuthorizer,
  developmentOrigin?: string
): LumoraWindowContext {
  const context = authorize(event);
  if (
    event.senderFrame === null ||
    !isTrustedRendererUrl(event.senderFrame.url, developmentOrigin)
  ) {
    throw new IpcAccessError();
  }
  return context;
}

export function registerEnvironmentIpc({
  ipc,
  authorize,
  resolveScanner,
  openExternal,
  developmentOrigin
}: RegisterEnvironmentIpcDependencies): void {
  ipc.handle(IPC_CHANNELS.environmentScan, async (event) => {
    const context = assertTrusted(event, authorize, developmentOrigin);
    const scanner = resolveScanner(context);
    return DeveloperEnvironmentScanResultSchema.parse(await scanner.scan());
  });

  ipc.handle(IPC_CHANNELS.nodeDownloadOpen, async (event) => {
    assertTrusted(event, authorize, developmentOrigin);
    await openExternal(NODE_DOWNLOAD_URL);
    return ExternalOpenResultSchema.parse({ opened: true });
  });
}
