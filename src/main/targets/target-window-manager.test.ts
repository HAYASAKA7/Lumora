import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import { createWindowContextRegistry } from './window-context-registry';
import { createTargetWindowManager } from './target-window-manager';

const TARGET_ID = '1a84cc80-7c76-4660-8b6b-d081d888ec39';

class FakeWindow extends EventEmitter {
  private readonly contents: {
    id: number;
    isDestroyed(): boolean;
    send(channel: string, payload: unknown): void;
  };
  readonly send = vi.fn();
  readonly show = vi.fn();
  readonly focus = vi.fn();
  readonly restore = vi.fn();
  readonly close = vi.fn(() => {
    this.destroyed = true;
    this.emit('closed');
  });
  minimized = false;
  destroyed = false;

  constructor(senderId: number) {
    super();
    this.contents = {
      id: senderId,
      isDestroyed: () => this.destroyed,
      send: this.send
    };
  }

  get webContents(): {
    id: number;
    isDestroyed(): boolean;
    send(channel: string, payload: unknown): void;
  } {
    if (this.destroyed) {
      throw new Error('Object has been destroyed');
    }
    return this.contents;
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
    window.destroyed = true;
    expect(() => window.emit('closed')).not.toThrow();
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

  it('closes only the requested target and unregisters its authority', async () => {
    const contexts = createWindowContextRegistry();
    const otherTargetId = '37da69d5-57d5-46ef-b3c6-98db8df20793';
    const windows = new Map([
      [TARGET_ID, new FakeWindow(45)],
      [otherTargetId, new FakeWindow(46)]
    ]);
    const manager = createTargetWindowManager({
      contexts,
      createWindow: (id) => windows.get(id)!,
      loadWindow: vi.fn().mockResolvedValue(undefined)
    });
    await manager.open(TARGET_ID);
    await manager.open(otherTargetId);

    manager.close(TARGET_ID);
    manager.close(TARGET_ID);

    expect(windows.get(TARGET_ID)!.close).toHaveBeenCalledOnce();
    expect(windows.get(otherTargetId)!.close).not.toHaveBeenCalled();
    expect(contexts.get(45)).toBeNull();
    expect(contexts.get(46)).not.toBeNull();
  });

  it('forgets a target whose window was already destroyed', async () => {
    const contexts = createWindowContextRegistry();
    const window = new FakeWindow(47);
    const manager = createTargetWindowManager({
      contexts,
      createWindow: () => window,
      loadWindow: vi.fn().mockResolvedValue(undefined)
    });
    await manager.open(TARGET_ID);
    window.destroyed = true;

    expect(() => manager.close(TARGET_ID)).not.toThrow();
    expect(contexts.get(47)).toBeNull();
    expect(window.close).not.toHaveBeenCalled();
  });

  it('sends target-scoped events only to the matching live window', async () => {
    const contexts = createWindowContextRegistry();
    const otherTargetId = '37da69d5-57d5-46ef-b3c6-98db8df20793';
    const windows = new Map([
      [TARGET_ID, new FakeWindow(48)],
      [otherTargetId, new FakeWindow(49)]
    ]);
    const manager = createTargetWindowManager({
      contexts,
      createWindow: (id) => windows.get(id)!,
      loadWindow: vi.fn().mockResolvedValue(undefined)
    });
    await manager.open(TARGET_ID);
    await manager.open(otherTargetId);

    manager.send(TARGET_ID, 'lumora:terminal:runtime:event', { type: 'output' });

    expect(windows.get(TARGET_ID)!.send).toHaveBeenCalledWith(
      'lumora:terminal:runtime:event',
      { type: 'output' }
    );
    expect(windows.get(otherTargetId)!.send).not.toHaveBeenCalled();
  });
});
