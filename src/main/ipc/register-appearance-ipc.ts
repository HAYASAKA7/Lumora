import type { IpcAuthorizer } from './ipc-access';
import {
  AppearanceBackgroundStateSchema,
  IPC_CHANNELS,
  type AppearanceBackgroundState
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

interface AppearanceBackgroundService {
  getState(): Promise<AppearanceBackgroundState>;
  importFrom(path: string): Promise<AppearanceBackgroundState>;
  remove(): Promise<AppearanceBackgroundState>;
}

interface OpenDialogResult {
  canceled: boolean;
  filePaths: string[];
}

interface RegisterAppearanceIpcDependencies {
  ipc: IpcRegistrar;
  authorize: IpcAuthorizer;
  service: AppearanceBackgroundService;
  showOpenDialog(options: {
    properties: ['openFile'];
    filters: Array<{ name: string; extensions: string[] }>;
  }): Promise<OpenDialogResult>;
  developmentOrigin?: string;
}

class IpcAccessError extends Error {
  readonly code = 'IPC_UNTRUSTED_SENDER';
  constructor() {
    super('IPC_UNTRUSTED_SENDER: The IPC request did not originate from the Lumora renderer.');
    this.name = 'IpcAccessError';
  }
}

class AppearanceIpcError extends Error {
  readonly code = 'APPEARANCE_OPERATION_FAILED';
  constructor() {
    super('APPEARANCE_OPERATION_FAILED: Lumora could not complete the appearance operation.');
    this.name = 'AppearanceIpcError';
  }
}

function assertTrusted(
  event: IpcInvokeEventLike,
  authorize: IpcAuthorizer,
  developmentOrigin?: string
) {
  authorize(event);
  if (
    event.senderFrame === null ||
    !isTrustedRendererUrl(event.senderFrame.url, developmentOrigin)
  ) {
    throw new IpcAccessError();
  }
}

export function registerAppearanceIpc({
  ipc,
  authorize,
  service,
  showOpenDialog,
  developmentOrigin
}: RegisterAppearanceIpcDependencies): void {
  const safely = async (
    operation: () => Promise<AppearanceBackgroundState>
  ): Promise<AppearanceBackgroundState> => {
    try {
      return AppearanceBackgroundStateSchema.parse(await operation());
    } catch {
      throw new AppearanceIpcError();
    }
  };

  ipc.handle(IPC_CHANNELS.appearanceBackgroundGet, async (event) => {
    assertTrusted(event, authorize, developmentOrigin);
    return safely(() => service.getState());
  });

  ipc.handle(IPC_CHANNELS.appearanceBackgroundChoose, async (event) => {
    assertTrusted(event, authorize, developmentOrigin);
    try {
      const selection = await showOpenDialog({
        properties: ['openFile'],
        filters: [{
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'webp']
        }]
      });
      const selectedPath = selection.canceled ? undefined : selection.filePaths[0];
      return safely(() => selectedPath === undefined
        ? service.getState()
        : service.importFrom(selectedPath));
    } catch {
      throw new AppearanceIpcError();
    }
  });

  ipc.handle(IPC_CHANNELS.appearanceBackgroundRemove, async (event) => {
    assertTrusted(event, authorize, developmentOrigin);
    return safely(() => service.remove());
  });
}
