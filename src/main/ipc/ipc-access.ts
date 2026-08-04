import {
  LOCAL_EXECUTION_TARGET_ID,
  type LumoraWindowContext
} from '../../shared/contracts';
import { isTrustedRendererUrl } from '../security-policy';
import type { WindowContextRegistry } from '../targets/window-context-registry';

export interface TargetAwareIpcEvent {
  sender?: { id: number };
  senderFrame: { url: string } | null;
}

export type IpcAuthorizer = (
  event: TargetAwareIpcEvent
) => LumoraWindowContext;

export class IpcAccessError extends Error {
  readonly code = 'IPC_UNTRUSTED_SENDER';

  constructor() {
    super(
      'IPC_UNTRUSTED_SENDER: The IPC request is not authorized for this Lumora window.'
    );
    this.name = 'IpcAccessError';
  }
}

interface CreateIpcAuthorizerOptions {
  contexts: WindowContextRegistry;
  developmentOrigin?: string;
}

export function createIpcAuthorizer({
  contexts,
  developmentOrigin
}: CreateIpcAuthorizerOptions): IpcAuthorizer {
  return (event) => {
    if (
      event.senderFrame === null ||
      !isTrustedRendererUrl(event.senderFrame.url, developmentOrigin)
    ) {
      throw new IpcAccessError();
    }
    const senderId = event.sender?.id;
    const context = senderId === undefined ? null : contexts.get(senderId);
    if (context === null) throw new IpcAccessError();
    return context;
  };
}

export function createLocalIpcAuthorizer(
  options: CreateIpcAuthorizerOptions
): IpcAuthorizer {
  const authorize = createIpcAuthorizer(options);
  return (event) => {
    const context = authorize(event);
    if (
      context.mode !== 'local' ||
      context.executionTargetId !== LOCAL_EXECUTION_TARGET_ID
    ) {
      throw new IpcAccessError();
    }
    return context;
  };
}
