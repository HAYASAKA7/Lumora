import {
  RemoteExecutionTargetIdSchema,
  type RemoteExecutionTargetId
} from '../../shared/contracts';
import type { WindowContextRegistry } from './window-context-registry';

export interface TargetWindowLike {
  webContents: {
    id: number;
    isDestroyed(): boolean;
    send(channel: string, payload: unknown): void;
  };
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  close(): void;
  on(event: 'close', listener: (event: TargetWindowCloseEvent) => void): this;
  once(event: 'closed', listener: () => void): this;
}

export interface TargetWindowCloseEvent {
  preventDefault(): void;
}

interface CreateTargetWindowManagerOptions<Window extends TargetWindowLike> {
  contexts: WindowContextRegistry;
  createWindow(id: RemoteExecutionTargetId): Window;
  loadWindow(window: Window): Promise<void>;
  onCloseRequested?: (
    id: RemoteExecutionTargetId,
    event: TargetWindowCloseEvent
  ) => void;
}

function focusWindow(window: TargetWindowLike): void {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

export function createTargetWindowManager<Window extends TargetWindowLike>({
  contexts,
  createWindow,
  loadWindow,
  onCloseRequested
}: CreateTargetWindowManagerOptions<Window>) {
  const windows = new Map<RemoteExecutionTargetId, Window>();
  const senderIds = new WeakMap<Window, number>();
  const pending = new Map<RemoteExecutionTargetId, Promise<void>>();
  const programmaticCloses = new WeakSet<Window>();

  const closeWindow = (window: Window): void => {
    if (window.isDestroyed()) return;
    programmaticCloses.add(window);
    window.close();
  };

  const open = (input: RemoteExecutionTargetId): Promise<void> => {
    const id = RemoteExecutionTargetIdSchema.parse(input);
    const opening = pending.get(id);
    if (opening !== undefined) {
      return opening.then(() => {
        const window = windows.get(id);
        if (window !== undefined) focusWindow(window);
      });
    }
    const existing = windows.get(id);
    if (existing !== undefined && !existing.isDestroyed()) {
      focusWindow(existing);
      return Promise.resolve();
    }
    if (existing !== undefined) windows.delete(id);

    const window = createWindow(id);
    const senderId = window.webContents.id;
    senderIds.set(window, senderId);
    contexts.register(senderId, {
      mode: 'remote',
      executionTargetId: id
    });
    windows.set(id, window);
    window.on('close', (event) => {
      if (programmaticCloses.delete(window)) return;
      onCloseRequested?.(id, event);
    });
    window.once('closed', () => {
      contexts.unregister(senderId);
      senderIds.delete(window);
      if (windows.get(id) === window) windows.delete(id);
    });

    let creation: Promise<void>;
    creation = loadWindow(window).then(() => {
      focusWindow(window);
    }).catch((error: unknown) => {
      contexts.unregister(senderId);
      senderIds.delete(window);
      if (windows.get(id) === window) windows.delete(id);
      closeWindow(window);
      throw error;
    }).finally(() => {
      if (pending.get(id) === creation) pending.delete(id);
    });
    pending.set(id, creation);
    return creation;
  };

  return {
    open,
    send(
      input: RemoteExecutionTargetId,
      channel: string,
      payload: unknown
    ): boolean {
      const id = RemoteExecutionTargetIdSchema.parse(input);
      const window = windows.get(id);
      if (
        window === undefined ||
        window.isDestroyed() ||
        window.webContents.isDestroyed()
      ) return false;
      window.webContents.send(channel, payload);
      return true;
    },
    close(input: RemoteExecutionTargetId): void {
      const id = RemoteExecutionTargetIdSchema.parse(input);
      const window = windows.get(id);
      if (window === undefined) return;
      windows.delete(id);
      const senderId = senderIds.get(window);
      if (senderId !== undefined) contexts.unregister(senderId);
      senderIds.delete(window);
      closeWindow(window);
    },
    closeAll(): void {
      for (const id of [...windows.keys()]) this.close(id);
    }
  };
}

export type TargetWindowManager = ReturnType<typeof createTargetWindowManager>;
