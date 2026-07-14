import {
  ClipboardTextSchema,
  ClipboardWriteResultSchema,
  IPC_CHANNELS
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

interface ClipboardAdapter {
  readText(): string;
  writeText(text: string): void;
}

interface RegisterClipboardIpcDependencies {
  ipc: IpcRegistrar;
  clipboard: ClipboardAdapter;
  developmentOrigin?: string;
}

class IpcAccessError extends Error {
  readonly code = 'IPC_UNTRUSTED_SENDER';

  constructor() {
    super(
      'IPC_UNTRUSTED_SENDER: The IPC request did not originate from the Lumora renderer.'
    );
    this.name = 'IpcAccessError';
  }
}

class ClipboardIpcError extends Error {
  readonly code = 'CLIPBOARD_OPERATION_FAILED';

  constructor() {
    super(
      'CLIPBOARD_OPERATION_FAILED: Lumora could not complete the clipboard operation.'
    );
    this.name = 'ClipboardIpcError';
  }
}

function assertTrusted(
  event: IpcInvokeEventLike,
  developmentOrigin?: string
): void {
  if (
    event.senderFrame === null ||
    !isTrustedRendererUrl(event.senderFrame.url, developmentOrigin)
  ) {
    throw new IpcAccessError();
  }
}

export function registerClipboardIpc({
  ipc,
  clipboard,
  developmentOrigin
}: RegisterClipboardIpcDependencies): void {
  ipc.handle(IPC_CHANNELS.clipboardTextRead, async (event) => {
    assertTrusted(event, developmentOrigin);

    try {
      return ClipboardTextSchema.parse(clipboard.readText());
    } catch {
      throw new ClipboardIpcError();
    }
  });

  ipc.handle(IPC_CHANNELS.clipboardTextWrite, async (event, input) => {
    assertTrusted(event, developmentOrigin);
    const text = ClipboardTextSchema.parse(input);

    try {
      clipboard.writeText(text);
    } catch {
      throw new ClipboardIpcError();
    }

    return ClipboardWriteResultSchema.parse({ accepted: true });
  });
}
