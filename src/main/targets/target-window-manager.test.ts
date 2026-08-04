import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import { createWindowContextRegistry } from './window-context-registry';
import { createTargetWindowManager } from './target-window-manager';

const TARGET_ID = '1a84cc80-7c76-4660-8b6b-d081d888ec39';

class FakeWindow extends EventEmitter {
  readonly webContents: { id: number; isDestroyed(): boolean };
  readonly show = vi.fn();
  readonly focus = vi.fn();
  readonly restore = vi.fn();
  readonly close = vi.fn(() => this.emit('closed'));
  minimized = false;
  destroyed = false;

  constructor(senderId: number) {
    super();
    this.webContents = {
      id: senderId,
      isDestroyed: () => this.destroyed
    };
  }

  isDestroyed(): boolean { return this.destroyed; }
  isMinimized(): boolean { return this.minimized; }
}

describe('target window manager', () => {
  it('binds context before loading and focuses one window per target', async () => {
    const contexts = createWindowContextRegistry();
    const window = new FakeWindow(42);
    const sequence: string[] = [];
    const manager = createTargetWindowManager({
      contexts,
      createWindow: () => {
        sequence.push('create');
        return window;
      },
      loadWindow: async (created) => {
        sequence.push('load');
        expect(contexts.get(created.webContents.id)).toEqual({
          mode: 'remote', executionTargetId: TARGET_ID
        });
      }
    });

    await manager.open(TARGET_ID);
    await manager.open(TARGET_ID);

    expect(sequence).toEqual(['create', 'load']);
    expect(window.show).toHaveBeenCalledTimes(2);
    expect(window.focus).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent opens and unregisters authority on close', async () => {
    const contexts = createWindowContextRegistry();
    const window = new FakeWindow(43);
    let finishLoad: (() => void) | null = null;
    const loadWindow = vi.fn(() => new Promise<void>((resolve) => {
      finishLoad = resolve;
    }));
    const createWindow = vi.fn(() => window);
    const manager = createTargetWindowManager({ contexts, createWindow, loadWindow });

    const first = manager.open(TARGET_ID);
    const second = manager.open(TARGET_ID);
    await vi.waitFor(() => expect(finishLoad).not.toBeNull());
    finishLoad!();
    await Promise.all([first, second]);

    expect(createWindow).toHaveBeenCalledOnce();
    expect(loadWindow).toHaveBeenCalledOnce();
    expect(contexts.get(43)).not.toBeNull();
    window.emit('closed');
    expect(contexts.get(43)).toBeNull();
  });

  it('closes all target windows without retaining stale entries', async () => {
    const contexts = createWindowContextRegistry();
    const window = new FakeWindow(44);
    const manager = createTargetWindowManager({
      contexts,
      createWindow: () => window,
      loadWindow: vi.fn().mockResolvedValue(undefined)
    });
    await manager.open(TARGET_ID);

    manager.closeAll();
    manager.closeAll();

    expect(window.close).toHaveBeenCalledOnce();
    expect(contexts.get(44)).toBeNull();
  });
});
