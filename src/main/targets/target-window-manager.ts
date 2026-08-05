import {
  RemoteExecutionTargetIdSchema,
  type RemoteExecutionTargetId
} from '../../shared/contracts';
import type { WindowContextRegistry } from './window-context-registry';

export interface TargetWindowLike {
  webContents: {
    id: number;
    isDestroyed(): boolean;
  };
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  close(): void;
  once(event: 'closed', listener: () => void): this;
}

interface CreateTargetWindowManagerOptions<Window extends TargetWindowLike> {
  contexts: WindowContextRegistry;
  createWindow(id: RemoteExecutionTargetId): Window;
  loadWindow(window: Window): Promise<void>;
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
  loadWindow
}: CreateTargetWindowManagerOptions<Window>) {
  const windows = new Map<RemoteExecutionTargetId, Window>();
  const senderIds = new WeakMap<Window, number>();
  const pending = new Map<RemoteExecutionTargetId, Promise<void>>();

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
      if (!window.isDestroyed()) window.close();
      throw error;
    }).finally(() => {
      if (pending.get(id) === creation) pending.delete(id);
    });
    pending.set(id, creation);
    return creation;
  };

  return {
    open,
    closeAll(): void {
      for (const window of windows.values()) {
        const senderId = senderIds.get(window);
        if (senderId !== undefined) contexts.unregister(senderId);
        senderIds.delete(window);
        if (!window.isDestroyed()) window.close();
      }
      windows.clear();
    }
  };
}

export type TargetWindowManager = ReturnType<typeof createTargetWindowManager>;
