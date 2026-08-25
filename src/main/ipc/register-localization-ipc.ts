import {
  IPC_CHANNELS,
  FontPresetListSchema,
  LocaleReloadResultSchema,
  LocalizationFolderOpenResultSchema,
  LocalizationSnapshotSchema,
  ModsRootChooseResultSchema,
  ModsSettingsSchema,
  type LocaleReloadResult,
  type FontPresetList,
  type LocalizationSnapshot,
  type ModsRootChooseResult,
  type ModsSettings
} from '../../shared/contracts';
import { isTrustedRendererUrl } from '../security-policy';
import type { IpcAuthorizer } from './ipc-access';

type IpcEvent = { senderFrame: { url: string } | null };
type IpcRegistrar = {
  handle(
    channel: string,
    handler: (event: IpcEvent) => Promise<unknown> | unknown
  ): void;
};
type LocalizationServicePort = {
  getSnapshot(): LocalizationSnapshot;
  reload(): LocaleReloadResult;
  subscribe(listener: (snapshot: LocalizationSnapshot) => void): () => void;
};

class LocalizationIpcError extends Error {
  readonly code = 'LOCALIZATION_OPERATION_FAILED';

  constructor() {
    super('LOCALIZATION_OPERATION_FAILED: Lumora could not complete the localization operation.');
    this.name = 'LocalizationIpcError';
  }
}

class IpcAccessError extends Error {
  readonly code = 'IPC_UNTRUSTED_SENDER';

  constructor() {
    super('IPC_UNTRUSTED_SENDER: The IPC request did not originate from the Lumora renderer.');
    this.name = 'IpcAccessError';
  }
}

export function registerLocalizationIpc(input: {
  ipc: IpcRegistrar;
  authorize: IpcAuthorizer;
  authorizeLocal: IpcAuthorizer;
  service: LocalizationServicePort;
  openUserLocaleFolder(): Promise<void>;
  getModsSettings(): Promise<ModsSettings>;
  chooseModsRoot(): Promise<ModsRootChooseResult>;
  resetModsRoot(): Promise<ModsSettings>;
  openModsRoot(): Promise<void>;
  getFontPresets(): Promise<FontPresetList>;
  openFontPresetFolder(): Promise<void>;
  broadcast(snapshot: LocalizationSnapshot): void;
  developmentOrigin?: string;
}): () => void {
  const authorize = (
    event: IpcEvent,
    authorizer: IpcAuthorizer = input.authorize
  ): void => {
    authorizer(event);
    if (
      event.senderFrame === null ||
      !isTrustedRendererUrl(event.senderFrame.url, input.developmentOrigin)
    ) {
      throw new IpcAccessError();
    }
  };
  const safely = async <T>(operation: () => T | Promise<T>): Promise<T> => {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof IpcAccessError) throw error;
      throw new LocalizationIpcError();
    }
  };

  input.ipc.handle(IPC_CHANNELS.localizationSnapshotGet, async (event) => {
    authorize(event);
    return safely(() => LocalizationSnapshotSchema.parse(
      input.service.getSnapshot()
    ));
  });
  input.ipc.handle(IPC_CHANNELS.localizationReload, async (event) => {
    authorize(event, input.authorizeLocal);
    return safely(() => LocaleReloadResultSchema.parse(input.service.reload()));
  });
  input.ipc.handle(IPC_CHANNELS.localizationUserFolderOpen, async (event) => {
    authorize(event, input.authorizeLocal);
    return safely(async () => {
      await input.openUserLocaleFolder();
      return LocalizationFolderOpenResultSchema.parse({ opened: true });
    });
  });
  input.ipc.handle(IPC_CHANNELS.modsSettingsGet, async (event) => {
    authorize(event, input.authorizeLocal);
    return safely(async () => ModsSettingsSchema.parse(
      await input.getModsSettings()
    ));
  });
  input.ipc.handle(IPC_CHANNELS.modsRootChoose, async (event) => {
    authorize(event, input.authorizeLocal);
    return safely(async () => ModsRootChooseResultSchema.parse(
      await input.chooseModsRoot()
    ));
  });
  input.ipc.handle(IPC_CHANNELS.modsRootReset, async (event) => {
    authorize(event, input.authorizeLocal);
    return safely(async () => ModsSettingsSchema.parse(
      await input.resetModsRoot()
    ));
  });
  input.ipc.handle(IPC_CHANNELS.modsRootOpen, async (event) => {
    authorize(event, input.authorizeLocal);
    return safely(async () => {
      await input.openModsRoot();
      return LocalizationFolderOpenResultSchema.parse({ opened: true });
    });
  });
  input.ipc.handle(IPC_CHANNELS.fontPresetsGet, async (event) => {
    authorize(event, input.authorizeLocal);
    return safely(async () => FontPresetListSchema.parse(
      await input.getFontPresets()
    ));
  });
  input.ipc.handle(IPC_CHANNELS.fontPresetFolderOpen, async (event) => {
    authorize(event, input.authorizeLocal);
    return safely(async () => {
      await input.openFontPresetFolder();
      return LocalizationFolderOpenResultSchema.parse({ opened: true });
    });
  });

  return input.service.subscribe((snapshot) => {
    input.broadcast(LocalizationSnapshotSchema.parse(snapshot));
  });
}
