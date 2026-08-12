import type { IpcAuthorizer } from './ipc-access';
import {
  ClipboardTextSchema,
  ClipboardWriteResultSchema,
  TerminalClipboardReadRequestSchema,
  TerminalClipboardReadResultSchema,
  IPC_CHANNELS
} from '../../shared/contracts';
import type {
  LumoraWindowContext,
  TerminalClipboardReadRequest
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
  authorize: IpcAuthorizer;
  clipboard: ClipboardAdapter;
  readTerminalClipboard(
    context: LumoraWindowContext,
    request: TerminalClipboardReadRequest
  ): Promise<unknown>;
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

export function registerClipboardIpc({
  ipc,
  authorize,
  clipboard,
  readTerminalClipboard,
  developmentOrigin
}: RegisterClipboardIpcDependencies): void {
  ipc.handle(IPC_CHANNELS.clipboardTextRead, async (event) => {
    assertTrusted(event, authorize, developmentOrigin);

    try {
      return ClipboardTextSchema.parse(clipboard.readText());
    } catch {
      throw new ClipboardIpcError();
    }
  });

  ipc.handle(IPC_CHANNELS.clipboardTextWrite, async (event, input) => {
    assertTrusted(event, authorize, developmentOrigin);
    const text = ClipboardTextSchema.parse(input);

    try {
      clipboard.writeText(text);
    } catch {
      throw new ClipboardIpcError();
    }

    return ClipboardWriteResultSchema.parse({ accepted: true });
  });

  ipc.handle(IPC_CHANNELS.terminalClipboardRead, async (event, input) => {
    const context = assertTrusted(event, authorize, developmentOrigin);
    const request = TerminalClipboardReadRequestSchema.parse(input);
    try {
      return TerminalClipboardReadResultSchema.parse(
        await readTerminalClipboard(context, request)
      );
    } catch {
      throw new ClipboardIpcError();
    }
  });
}
