import {
  IPC_CHANNELS,
  ProviderScanResultSchema,
  ProviderUpdateCheckResultSchema,
  ProviderUpdateRequestSchema,
  ProviderUpdateResultSchema,
  type ProviderId,
  type ProviderScanResult,
  type ProviderUpdateCheckResult,
  type ProviderUpdateResult
} from '../../shared/contracts';
import { isTrustedRendererUrl } from '../security-policy';

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

interface ProviderRegistryLike {
  scan(): Promise<unknown>;
}

interface ProviderUpdatesLike {
  check(): Promise<unknown>;
  update(provider: ProviderId): Promise<unknown>;
}

interface RegisterProviderIpcDependencies {
  ipc: IpcRegistrar;
  registry: ProviderRegistryLike;
  updates: ProviderUpdatesLike;
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
  updates,
  developmentOrigin
}: RegisterProviderIpcDependencies): void {
  const assertTrusted = (event: IpcInvokeEventLike): void => {
    if (
      event.senderFrame === null ||
      !isTrustedRendererUrl(event.senderFrame.url, developmentOrigin)
    ) {
      throw new IpcAccessError();
    }
  };

  ipc.handle(
    IPC_CHANNELS.providerScan,
    async (event): Promise<ProviderScanResult> => {
      assertTrusted(event);
      return ProviderScanResultSchema.parse(await registry.scan());
    }
  );

  ipc.handle(
    IPC_CHANNELS.providerUpdatesCheck,
    async (event): Promise<ProviderUpdateCheckResult> => {
      assertTrusted(event);
      return ProviderUpdateCheckResultSchema.parse(await updates.check());
    }
  );

  ipc.handle(
    IPC_CHANNELS.providerUpdateRun,
    async (event, input): Promise<ProviderUpdateResult> => {
      assertTrusted(event);
      const request = ProviderUpdateRequestSchema.parse(input);
      return ProviderUpdateResultSchema.parse(
        await updates.update(request.provider)
      );
    }
  );
}
