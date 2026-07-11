import {
  IPC_CHANNELS,
  ProviderScanResultSchema,
  type ProviderScanResult
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

interface ProviderRegistryLike {
  scan(): Promise<unknown>;
}

interface RegisterProviderIpcDependencies {
  ipc: IpcRegistrar;
  registry: ProviderRegistryLike;
  developmentOrigin?: string;
}

class IpcAccessError extends Error {
  readonly code = 'IPC_UNTRUSTED_SENDER';

  constructor() {
    super('The IPC request did not originate from the Lumora renderer.');
    this.name = 'IpcAccessError';
  }
}

export function registerProviderIpc({
  ipc,
  registry,
  developmentOrigin
}: RegisterProviderIpcDependencies): void {
  ipc.handle(
    IPC_CHANNELS.providerScan,
    async (event): Promise<ProviderScanResult> => {
      if (
        event.senderFrame === null ||
        !isTrustedRendererUrl(event.senderFrame.url, developmentOrigin)
      ) {
        throw new IpcAccessError();
      }

      return ProviderScanResultSchema.parse(await registry.scan());
    }
  );
}
