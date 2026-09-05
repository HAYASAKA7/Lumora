import type { IpcAuthorizer } from './ipc-access';
import {
  IPC_CHANNELS,
  ExternalOpenResultSchema,
  ProviderScanRequestSchema,
  ProviderScanResultSchema,
  ProviderUpdateCheckResultSchema,
  ProviderUpdateCancelResultSchema,
  ProviderUpdateOutcomeSchema,
  ProviderUpdateRequestSchema,
  ProviderUpdateResultSchema,
  PROVIDER_LIFECYCLE_BUSY_CODE,
  PROVIDER_LIFECYCLE_CANCELLED_CODE,
  type LumoraWindowContext,
  type ProviderId,
  type ProviderScanResult,
  type ProviderUpdateCheckResult,
  type ProviderUpdateOutcome,
  type ProviderUpdateResult
} from '../../shared/contracts';
import { providerDefinition } from '../../shared/provider-definitions';
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
  /**
   * Re-probes rather than answering from the cache. Optional because a target
   * whose scan is never cached has nothing to bypass.
   */
  scanFresh?(): Promise<unknown>;
}

interface ProviderUpdatesLike {
  check(): Promise<unknown>;
  install(provider: ProviderId): Promise<unknown>;
  update(provider: ProviderId): Promise<unknown>;
  cancel(provider: ProviderId): boolean;
}

/**
 * npm's own text can carry registry credentials, so only the classified code
 * crosses to the renderer, which turns it into its own wording.
 */
async function lifecycleOutcome(
  operation: () => Promise<unknown>
): Promise<ProviderUpdateOutcome> {
  try {
    return ProviderUpdateOutcomeSchema.parse({
      outcome: 'completed',
      result: ProviderUpdateResultSchema.parse(await operation())
    });
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === PROVIDER_LIFECYCLE_CANCELLED_CODE) {
      return ProviderUpdateOutcomeSchema.parse({ outcome: 'cancelled' });
    }
    if (code === PROVIDER_LIFECYCLE_BUSY_CODE) throw new Error(code);
    throw error;
  }
}

interface ProviderTargetServices {
  registry: ProviderRegistryLike;
  updates: ProviderUpdatesLike;
}

interface RegisterProviderIpcDependencies {
  ipc: IpcRegistrar;
  authorize: IpcAuthorizer;
  resolveServices(context: LumoraWindowContext): ProviderTargetServices;
  openExternal(url: string): Promise<unknown>;
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
  authorize,
  resolveServices,
  openExternal,
  developmentOrigin
}: RegisterProviderIpcDependencies): void {
  const assertTrusted = (event: IpcInvokeEventLike): LumoraWindowContext => {
    const context = authorize(event);
    if (
      event.senderFrame === null ||
      !isTrustedRendererUrl(event.senderFrame.url, developmentOrigin)
    ) {
      throw new IpcAccessError();
    }
    return context;
  };

  ipc.handle(
    IPC_CHANNELS.providerScan,
    async (event, input): Promise<ProviderScanResult> => {
      const { registry } = resolveServices(assertTrusted(event));
      const { fresh } = ProviderScanRequestSchema.parse(input ?? {});
      const scan = fresh && registry.scanFresh !== undefined
        ? registry.scanFresh()
        : registry.scan();
      return ProviderScanResultSchema.parse(await scan);
    }
  );

  ipc.handle(
    IPC_CHANNELS.providerUpdateCancel,
    // eslint-disable-next-line @typescript-eslint/require-await
    async (event, input) => {
      const { updates } = resolveServices(assertTrusted(event));
      const request = ProviderUpdateRequestSchema.parse(input);
      return ProviderUpdateCancelResultSchema.parse({
        cancelled: updates.cancel(request.provider)
      });
    }
  );

  ipc.handle(
    IPC_CHANNELS.providerUpdatesCheck,
    async (event): Promise<ProviderUpdateCheckResult> => {
      const { updates } = resolveServices(assertTrusted(event));
      return ProviderUpdateCheckResultSchema.parse(await updates.check());
    }
  );

  ipc.handle(
    IPC_CHANNELS.providerUpdateRun,
    async (event, input): Promise<ProviderUpdateOutcome> => {
      const { updates } = resolveServices(assertTrusted(event));
      const request = ProviderUpdateRequestSchema.parse(input);
      return lifecycleOutcome(() => updates.update(request.provider));
    }
  );

  ipc.handle(
    IPC_CHANNELS.providerInstallRun,
    async (event, input): Promise<ProviderUpdateOutcome> => {
      const { updates } = resolveServices(assertTrusted(event));
      const request = ProviderUpdateRequestSchema.parse(input);
      return lifecycleOutcome(() => updates.install(request.provider));
    }
  );

  ipc.handle(
    IPC_CHANNELS.providerInstallGuideOpen,
    async (event, input) => {
      assertTrusted(event);
      const request = ProviderUpdateRequestSchema.parse(input);
      await openExternal(
        providerDefinition(request.provider).installGuideUrl
      );
      return ExternalOpenResultSchema.parse({ opened: true });
    }
  );
}
