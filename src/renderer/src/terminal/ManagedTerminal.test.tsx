import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  LumoraApi,
  RuntimeAttachment,
  RuntimeEvent,
  RuntimeSummary
} from '../../../shared/contracts';
import { ManagedTerminal, TERMINAL_EXIT_GRACE_MS } from './ManagedTerminal';
import { TERMINAL_INTERRUPT_CONFIRMATION_MS } from './terminal-interrupt-guard';

const xterm = vi.hoisted(() => ({
  attachCustomKeyEventHandler: vi.fn(),
  dataHandler: null as ((data: string) => void) | null,
  resizeHandler: null as ((size: { cols: number; rows: number }) => void) | null,
  customKeyEventHandler: null as ((event: KeyboardEvent) => boolean) | null,
  fitTerminal: vi.fn(),
  focusTerminal: vi.fn(),
  getSelection: vi.fn(),
  hasSelection: vi.fn(),
  pasteTerminal: vi.fn(),
  textarea: null as HTMLTextAreaElement | null,
  terminalOptions: null as {
    linkHandler?: {
      activate(event: MouseEvent, uri: string): void;
    };
  } | null,
  terminalConstructed: vi.fn(),
  terminalWrite: vi.fn()
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit(): void { xterm.fitTerminal(); }
  }
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    textarea: HTMLTextAreaElement | undefined;
    constructor(options?: {
      linkHandler?: {
        activate(event: MouseEvent, uri: string): void;
      };
    }) {
      xterm.terminalConstructed();
      xterm.terminalOptions = options ?? null;
      this.textarea = xterm.textarea ?? undefined;
    }
    parser = { registerOscHandler: vi.fn() };
    attachCustomKeyEventHandler(
      handler: (event: KeyboardEvent) => boolean
    ): void {
      xterm.customKeyEventHandler = handler;
      xterm.attachCustomKeyEventHandler(handler);
    }
    loadAddon(): void {}
    open(): void {}
    onData(listener: (data: string) => void): { dispose(): void } {
      xterm.dataHandler = listener;
      return {
        dispose() {
          if (xterm.dataHandler === listener) xterm.dataHandler = null;
        }
      };
    }
    onResize(
      listener: (size: { cols: number; rows: number }) => void
    ): { dispose(): void } {
      xterm.resizeHandler = listener;
      return {
        dispose() {
          if (xterm.resizeHandler === listener) xterm.resizeHandler = null;
        }
      };
    }
    hasSelection(): boolean { return xterm.hasSelection(); }
    getSelection(): string { return xterm.getSelection(); }
    paste(value: string): void { xterm.pasteTerminal(value); }
    write(data: string): void { xterm.terminalWrite(data); }
    focus(): void { xterm.focusTerminal(); }
    dispose(): void {}
  }
}));

type RuntimeApi = Pick<
  LumoraApi,
  | 'attachRuntime'
  | 'onRuntimeEvent'
  | 'openTerminalLink'
  | 'readClipboardText'
  | 'resizeRuntime'
  | 'terminateRuntime'
  | 'writeClipboardText'
  | 'writeRuntime'
>;

const runtime: RuntimeSummary = {
  id: '0198f8b6-18f3-7ca0-9f0f-123456789abc',
  displayName: 'Repository cleanup',
  strategy: 'new',
  sessionId: null,
  nativeSessionId: null,
  reconciliationState: 'pending',
  provider: 'codex',
  workspaceId: 'a'.repeat(64),
  terminalProfileId: 'b'.repeat(64),
  launchHash: 'c'.repeat(64),
  state: 'running',
  pid: 123,
  createdAt: '2026-07-11T04:00:00.000Z',
  startedAt: '2026-07-11T04:00:00.000Z',
  endedAt: null,
  exitCode: null,
  errorCode: null
};

function installLumora(overrides: Partial<RuntimeApi> = {}): RuntimeApi {
  const api: RuntimeApi = {
    attachRuntime: vi.fn().mockResolvedValue({
      runtime,
      snapshot: '',
      outputSequence: 0
    }),
    onRuntimeEvent: vi.fn(() => () => undefined),
    openTerminalLink: vi.fn().mockResolvedValue(undefined),
    readClipboardText: vi.fn().mockResolvedValue(''),
    resizeRuntime: vi.fn().mockResolvedValue(undefined),
    terminateRuntime: vi.fn().mockResolvedValue({
      ...runtime,
      state: 'completed',
      endedAt: '2026-07-29T01:00:00.000Z',
      exitCode: 0
    }),
    writeClipboardText: vi.fn().mockResolvedValue(undefined),
    writeRuntime: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
  Object.defineProperty(window, 'lumora', {
    configurable: true,
    value: api
  });
  return api;
}

function clipboardKey(
  code: string,
  modifiers: KeyboardEventInit
): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    code,
    ...modifiers
  });
}

describe('ManagedTerminal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    xterm.customKeyEventHandler = null;
    xterm.dataHandler = null;
    xterm.resizeHandler = null;
    xterm.terminalOptions = null;
    xterm.textarea = document.createElement('textarea');
    xterm.hasSelection.mockReturnValue(false);
    xterm.getSelection.mockReturnValue('');
  });

  it('opens confirmed terminal hyperlinks through the Lumora bridge', async () => {
    const openTerminalLink = vi.fn().mockResolvedValue(undefined);
    installLumora({ openTerminalLink });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <ManagedTerminal
        active
        onRuntimeChange={vi.fn()}
        platform="win32"
        runtime={runtime}
      />
    );
    await waitFor(() =>
      expect(xterm.terminalOptions?.linkHandler).toBeDefined()
    );

    act(() => {
      xterm.terminalOptions!.linkHandler!.activate(
        new MouseEvent('click'),
        'https://example.com/docs'
      );
    });

    await waitFor(() =>
      expect(openTerminalLink).toHaveBeenCalledWith(
        'https://example.com/docs'
      )
    );
    expect(confirm).toHaveBeenCalledOnce();
  });

  it('does not open a terminal hyperlink when confirmation is declined', async () => {
    const openTerminalLink = vi.fn().mockResolvedValue(undefined);
    installLumora({ openTerminalLink });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(
      <ManagedTerminal
        active
        onRuntimeChange={vi.fn()}
        platform="win32"
        runtime={runtime}
      />
    );
    await waitFor(() =>
      expect(xterm.terminalOptions?.linkHandler).toBeDefined()
    );

    act(() => {
      xterm.terminalOptions!.linkHandler!.activate(
        new MouseEvent('click'),
        'https://example.com/docs'
      );
    });

    expect(openTerminalLink).not.toHaveBeenCalled();
  });

  it('reports terminal hyperlink open failures inline', async () => {
    installLumora({
      openTerminalLink: vi.fn().mockRejectedValue(new Error('open failed'))
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <ManagedTerminal
        active
        onRuntimeChange={vi.fn()}
        platform="linux"
        runtime={runtime}
      />
    );
    await waitFor(() =>
      expect(xterm.terminalOptions?.linkHandler).toBeDefined()
    );

    act(() => {
      xterm.terminalOptions!.linkHandler!.activate(
        new MouseEvent('click'),
        'https://example.com/docs'
      );
    });

    expect((await screen.findByRole('alert')).textContent).toBe(
      'The terminal link could not be opened.'
    );
  });

  it('fills the available fixed terminal viewport', () => {
    installLumora({
      attachRuntime: vi.fn(
        () => new Promise<RuntimeAttachment>(() => undefined)
      )
    });

    render(
      <ManagedTerminal
        active
        onRuntimeChange={vi.fn()}
        platform="win32"
        runtime={runtime}
      />
    );

    expect(screen.getByLabelText('codex terminal')).toHaveStyle({
      blockSize: '100%'
    });
  });

  it('writes attachment output once when a live event is already in the snapshot', async () => {
    let resolveAttachment!: (attachment: RuntimeAttachment) => void;
    const attachRuntime = vi.fn(
      () =>
        new Promise<RuntimeAttachment>((resolve) => {
          resolveAttachment = resolve;
        })
    );
    let emitRuntime!: (event: RuntimeEvent) => void;
    const onRuntimeEvent = vi.fn(
      (listener: (event: RuntimeEvent) => void) => {
        emitRuntime = listener;
        return () => undefined;
      }
    );
    installLumora({ attachRuntime, onRuntimeEvent });

    render(
      <ManagedTerminal
        active
        onRuntimeChange={vi.fn()}
        platform="win32"
        runtime={runtime}
      />
    );
    await waitFor(() => expect(onRuntimeEvent).toHaveBeenCalled());

    act(() => {
      emitRuntime({
        type: 'output',
        runtimeId: runtime.id,
        sequence: 1,
        data: 'ready\r\n'
      });
    });
    await act(async () => {
      resolveAttachment({
        runtime,
        snapshot: 'ready\r\n',
        outputSequence: 1
      });
    });

    await waitFor(() => expect(xterm.terminalWrite).toHaveBeenCalledTimes(1));
    expect(xterm.terminalWrite).toHaveBeenLastCalledWith('ready\r\n');

    act(() => {
      emitRuntime({
        type: 'output',
        runtimeId: runtime.id,
        sequence: 2,
        data: 'next\r\n'
      });
    });
    expect(xterm.terminalWrite).toHaveBeenCalledTimes(2);
    expect(xterm.terminalWrite).toHaveBeenLastCalledWith('next\r\n');
  });

  it('stops forwarding input and resize after the runtime finishes', async () => {
    let emitRuntime!: (event: RuntimeEvent) => void;
    const onRuntimeEvent = vi.fn(
      (listener: (event: RuntimeEvent) => void) => {
        emitRuntime = listener;
        return () => undefined;
      }
    );
    const onRuntimeChange = vi.fn();
    const api = installLumora({ onRuntimeEvent });

    render(
      <ManagedTerminal
        active
        onRuntimeChange={onRuntimeChange}
        platform="win32"
        runtime={runtime}
      />
    );
    await waitFor(() => expect(onRuntimeChange).toHaveBeenCalledWith(runtime));
    expect(xterm.dataHandler).not.toBeNull();
    expect(xterm.resizeHandler).not.toBeNull();
    vi.mocked(api.writeRuntime).mockClear();
    vi.mocked(api.resizeRuntime).mockClear();

    act(() => {
      emitRuntime({
        type: 'state',
        runtimeId: runtime.id,
        runtime: {
          ...runtime,
          state: 'completed',
          endedAt: '2026-07-11T04:05:00.000Z',
          exitCode: 0
        }
      });
      xterm.dataHandler?.('late input');
      xterm.resizeHandler?.({ cols: 120, rows: 36 });
    });

    expect(api.writeRuntime).not.toHaveBeenCalled();
    expect(api.resizeRuntime).not.toHaveBeenCalled();
  });

  it('defers live output while IME composition is active and flushes it in order', async () => {
    let emitRuntime!: (event: RuntimeEvent) => void;
    const onRuntimeEvent = vi.fn(
      (listener: (event: RuntimeEvent) => void) => {
        emitRuntime = listener;
        return () => undefined;
      }
    );
    installLumora({ onRuntimeEvent });

    render(
      <ManagedTerminal
        active
        onRuntimeChange={vi.fn()}
        platform="win32"
        runtime={runtime}
      />
    );
    await waitFor(() => expect(onRuntimeEvent).toHaveBeenCalled());
    await waitFor(() => expect(xterm.focusTerminal).toHaveBeenCalled());
    xterm.terminalWrite.mockClear();

    fireEvent.compositionStart(xterm.textarea!);
    act(() => {
      emitRuntime({
        type: 'output',
        runtimeId: runtime.id,
        sequence: 1,
        data: 'first'
      });
      emitRuntime({
        type: 'output',
        runtimeId: runtime.id,
        sequence: 2,
        data: ' second'
      });
    });
    expect(xterm.terminalWrite).not.toHaveBeenCalled();

    fireEvent.compositionEnd(xterm.textarea!);
    await waitFor(() => {
      expect(xterm.terminalWrite).toHaveBeenCalledOnce();
    });
    expect(xterm.terminalWrite).toHaveBeenCalledWith('first second');
  });

  it('fits and focuses only when its mounted terminal becomes active', async () => {
    const attachRuntime = vi.fn().mockResolvedValue({
      runtime,
      snapshot: '',
      outputSequence: 0
    });
    installLumora({ attachRuntime });
    const onRuntimeChange = vi.fn();

    const { rerender } = render(
      <ManagedTerminal
        active={false}
        onRuntimeChange={onRuntimeChange}
        platform="win32"
        runtime={runtime}
      />
    );
    await waitFor(() => expect(attachRuntime).toHaveBeenCalled());
    await waitFor(() => expect(xterm.fitTerminal).toHaveBeenCalledTimes(1));
    expect(xterm.focusTerminal).not.toHaveBeenCalled();

    rerender(
      <ManagedTerminal
        active
        onRuntimeChange={onRuntimeChange}
        platform="win32"
        runtime={runtime}
      />
    );

    await waitFor(() => expect(xterm.fitTerminal).toHaveBeenCalledTimes(2));
    expect(xterm.focusTerminal).toHaveBeenCalledTimes(1);
  });

  it('refocuses an active terminal when a new focus request arrives', async () => {
    installLumora();
    const onRuntimeChange = vi.fn();
    const { rerender } = render(
      <ManagedTerminal
        active
        focusRequestKey={0}
        onRuntimeChange={onRuntimeChange}
        platform="win32"
        runtime={runtime}
      />
    );
    await waitFor(() => expect(xterm.focusTerminal).toHaveBeenCalled());
    xterm.fitTerminal.mockClear();
    xterm.focusTerminal.mockClear();

    rerender(
      <ManagedTerminal
        active
        focusRequestKey={1}
        onRuntimeChange={onRuntimeChange}
        platform="win32"
        runtime={runtime}
      />
    );

    expect(xterm.fitTerminal).toHaveBeenCalledTimes(1);
    expect(xterm.focusTerminal).toHaveBeenCalledTimes(1);
  });

  it('copies selected text for Windows Ctrl+C and consumes the key event', async () => {
    const writeClipboardText = vi.fn().mockResolvedValue(undefined);
    installLumora({ writeClipboardText });
    xterm.hasSelection.mockReturnValue(true);
    xterm.getSelection.mockReturnValue('selected text');
    render(
      <ManagedTerminal
        active
        onRuntimeChange={vi.fn()}
        platform="win32"
        runtime={runtime}
      />
    );
    await waitFor(() => expect(xterm.customKeyEventHandler).not.toBeNull());
    const event = clipboardKey('KeyC', { ctrlKey: true });

    let handled!: boolean;
    act(() => { handled = xterm.customKeyEventHandler!(event); });

    expect(handled).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(writeClipboardText).toHaveBeenCalledTimes(1);
    });
    expect(writeClipboardText).toHaveBeenCalledWith('selected text');
  });

  it('stops the runtime after a second unselected Windows Ctrl+C', async () => {
    const writeClipboardText = vi.fn().mockResolvedValue(undefined);
    const terminateRuntime = vi.fn().mockResolvedValue({
      ...runtime,
      state: 'completed',
      endedAt: '2026-07-29T01:00:00.000Z',
      exitCode: 0
    });
    const onRuntimeChange = vi.fn();
    installLumora({ terminateRuntime, writeClipboardText });
    render(
      <ManagedTerminal
        active
        onRuntimeChange={onRuntimeChange}
        platform="win32"
        runtime={runtime}
      />
    );
    await waitFor(() => expect(xterm.customKeyEventHandler).not.toBeNull());
    const firstEvent = clipboardKey('KeyC', { ctrlKey: true });

    let firstHandled!: boolean;
    act(() => { firstHandled = xterm.customKeyEventHandler!(firstEvent); });

    expect(firstHandled).toBe(false);
    expect(firstEvent.defaultPrevented).toBe(true);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Press Ctrl+C again to interrupt'
    );

    const secondEvent = clipboardKey('KeyC', { ctrlKey: true });
    let secondHandled!: boolean;
    act(() => { secondHandled = xterm.customKeyEventHandler!(secondEvent); });

    expect(secondHandled).toBe(false);
    expect(secondEvent.defaultPrevented).toBe(true);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(writeClipboardText).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(terminateRuntime).toHaveBeenCalledWith(runtime.id);
    });
    expect(onRuntimeChange).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'completed' })
    );
  });

  it('does not let a held Ctrl+C key repeat confirm the interrupt', async () => {
    const terminateRuntime = vi.fn().mockResolvedValue({
      ...runtime,
      state: 'completed',
      endedAt: '2026-07-29T01:00:00.000Z',
      exitCode: 0
    });
    installLumora({ terminateRuntime });
    render(
      <ManagedTerminal
        active
        onRuntimeChange={vi.fn()}
        platform="win32"
        runtime={runtime}
      />
    );
    await waitFor(() => expect(xterm.customKeyEventHandler).not.toBeNull());

    act(() => {
      xterm.customKeyEventHandler!(clipboardKey('KeyC', { ctrlKey: true }));
    });
    const repeatEvent = clipboardKey('KeyC', { ctrlKey: true, repeat: true });
    let repeatHandled!: boolean;
    act(() => { repeatHandled = xterm.customKeyEventHandler!(repeatEvent); });

    expect(repeatHandled).toBe(false);
    expect(repeatEvent.defaultPrevented).toBe(true);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(terminateRuntime).not.toHaveBeenCalled();

    const secondPhysicalEvent = clipboardKey('KeyC', { ctrlKey: true });
    let secondHandled!: boolean;
    act(() => {
      secondHandled = xterm.customKeyEventHandler!(secondPhysicalEvent);
    });
    expect(secondHandled).toBe(false);
    expect(secondPhysicalEvent.defaultPrevented).toBe(true);
    await waitFor(() => expect(terminateRuntime).toHaveBeenCalledOnce());
  });

  it('clears interrupt confirmation when another key is pressed', async () => {
    installLumora();
    render(
      <ManagedTerminal
        active
        onRuntimeChange={vi.fn()}
        platform="win32"
        runtime={runtime}
      />
    );
    await waitFor(() => expect(xterm.customKeyEventHandler).not.toBeNull());

    act(() => {
      xterm.customKeyEventHandler!(clipboardKey('KeyC', { ctrlKey: true }));
    });
    expect(screen.getByRole('status')).toBeInTheDocument();

    const unrelatedEvent = clipboardKey('KeyX', {});
    let unrelatedHandled!: boolean;
    act(() => {
      unrelatedHandled = xterm.customKeyEventHandler!(unrelatedEvent);
    });
    expect(unrelatedHandled).toBe(true);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    const nextInterrupt = clipboardKey('KeyC', { ctrlKey: true });
    let nextHandled!: boolean;
    act(() => { nextHandled = xterm.customKeyEventHandler!(nextInterrupt); });
    expect(nextHandled).toBe(false);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('expires interrupt confirmation after the safety window', async () => {
    installLumora();
    render(
      <ManagedTerminal
        active
        onRuntimeChange={vi.fn()}
        platform="win32"
        runtime={runtime}
      />
    );
    await waitFor(() => expect(xterm.customKeyEventHandler).not.toBeNull());

    vi.useFakeTimers();
    try {
      act(() => {
        xterm.customKeyEventHandler!(clipboardKey('KeyC', { ctrlKey: true }));
      });
      expect(screen.getByRole('status')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(TERMINAL_INTERRUPT_CONFIRMATION_MS);
      });
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears interrupt confirmation when the terminal becomes inactive', async () => {
    installLumora();
    const onRuntimeChange = vi.fn();
    const { rerender } = render(
      <ManagedTerminal
        active
        onRuntimeChange={onRuntimeChange}
        platform="win32"
        runtime={runtime}
      />
    );
    await waitFor(() => expect(xterm.customKeyEventHandler).not.toBeNull());

    act(() => {
      xterm.customKeyEventHandler!(clipboardKey('KeyC', { ctrlKey: true }));
    });
    expect(screen.getByRole('status')).toBeInTheDocument();

    rerender(
      <ManagedTerminal
        active={false}
        onRuntimeChange={onRuntimeChange}
        platform="win32"
        runtime={runtime}
      />
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('clears interrupt confirmation when the runtime is replaced', async () => {
    installLumora();
    const onRuntimeChange = vi.fn();
    const { rerender } = render(
      <ManagedTerminal
        active
        onRuntimeChange={onRuntimeChange}
        platform="win32"
        runtime={runtime}
      />
    );
    await waitFor(() => expect(xterm.customKeyEventHandler).not.toBeNull());

    act(() => {
      xterm.customKeyEventHandler!(clipboardKey('KeyC', { ctrlKey: true }));
    });
    expect(screen.getByRole('status')).toBeInTheDocument();

    rerender(
      <ManagedTerminal
        active
        onRuntimeChange={onRuntimeChange}
        platform="win32"
        runtime={{ ...runtime, id: '0198f8b6-18f3-7ca0-9f0f-abcdef012345' }}
      />
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('stops a Codex runtime that remains live after an explicit exit command', async () => {
    const terminateRuntime = vi.fn().mockResolvedValue({
      ...runtime,
      state: 'completed',
      endedAt: '2026-07-29T01:00:00.000Z',
      exitCode: 0
    });
    installLumora({ terminateRuntime });
    render(
      <ManagedTerminal
        active
        onRuntimeChange={vi.fn()}
        platform="win32"
        runtime={runtime}
      />
    );
    await waitFor(() => expect(xterm.dataHandler).not.toBeNull());

    vi.useFakeTimers();
    try {
      await act(async () => {
        xterm.dataHandler?.('/exit\r');
        await Promise.resolve();
      });
      expect(terminateRuntime).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(TERMINAL_EXIT_GRACE_MS);
      });
      expect(terminateRuntime).toHaveBeenCalledOnce();
      expect(terminateRuntime).toHaveBeenCalledWith(runtime.id);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels the explicit exit fallback when Codex exits naturally', async () => {
    let emitRuntime!: (event: RuntimeEvent) => void;
    const onRuntimeEvent = vi.fn(
      (listener: (event: RuntimeEvent) => void) => {
        emitRuntime = listener;
        return () => undefined;
      }
    );
    const terminateRuntime = vi.fn().mockResolvedValue({
      ...runtime,
      state: 'completed',
      endedAt: '2026-07-29T01:00:00.000Z',
      exitCode: 0
    });
    installLumora({ onRuntimeEvent, terminateRuntime });
    render(
      <ManagedTerminal
        active
        onRuntimeChange={vi.fn()}
        platform="win32"
        runtime={runtime}
      />
    );
    await waitFor(() => expect(xterm.dataHandler).not.toBeNull());

    vi.useFakeTimers();
    try {
      await act(async () => {
        xterm.dataHandler?.('/quit\r');
        await Promise.resolve();
      });
      act(() => {
        emitRuntime({
          type: 'state',
          runtimeId: runtime.id,
          runtime: {
            ...runtime,
            state: 'completed',
            endedAt: '2026-07-29T01:00:00.000Z',
            exitCode: 0
          }
        });
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(TERMINAL_EXIT_GRACE_MS);
      });
      expect(terminateRuntime).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels the explicit exit fallback when the terminal unmounts', async () => {
    const terminateRuntime = vi.fn().mockResolvedValue({
      ...runtime,
      state: 'completed',
      endedAt: '2026-07-29T01:00:00.000Z',
      exitCode: 0
    });
    installLumora({ terminateRuntime });
    const { unmount } = render(
      <ManagedTerminal
        active
        onRuntimeChange={vi.fn()}
        platform="linux"
        runtime={runtime}
      />
    );
    await waitFor(() => expect(xterm.dataHandler).not.toBeNull());

    vi.useFakeTimers();
    try {
      await act(async () => {
        xterm.dataHandler?.('/exit\n');
        await Promise.resolve();
      });
      unmount();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(TERMINAL_EXIT_GRACE_MS);
      });
      expect(terminateRuntime).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not arm the exit fallback for another provider', async () => {
    const terminateRuntime = vi.fn();
    installLumora({ terminateRuntime });
    render(
      <ManagedTerminal
        active
        onRuntimeChange={vi.fn()}
        platform="darwin"
        runtime={{ ...runtime, provider: 'claude' }}
      />
    );
    await waitFor(() => expect(xterm.dataHandler).not.toBeNull());

    vi.useFakeTimers();
    try {
      await act(async () => {
        xterm.dataHandler?.('/exit\r');
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(TERMINAL_EXIT_GRACE_MS);
      });
      expect(terminateRuntime).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not arm the exit fallback for ordinary Codex input', async () => {
    const terminateRuntime = vi.fn();
    installLumora({ terminateRuntime });
    render(
      <ManagedTerminal
        active
        onRuntimeChange={vi.fn()}
        platform="win32"
        runtime={runtime}
      />
    );
    await waitFor(() => expect(xterm.dataHandler).not.toBeNull());

    vi.useFakeTimers();
    try {
      await act(async () => {
        xterm.dataHandler?.('please explain /exit behavior\r');
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(TERMINAL_EXIT_GRACE_MS);
      });
      expect(terminateRuntime).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('pastes clipboard text on terminal right-click and restores focus', async () => {
    const readClipboardText = vi.fn().mockResolvedValue('from right click');
    installLumora({ readClipboardText });
    render(
      <ManagedTerminal
        active
        onRuntimeChange={vi.fn()}
        platform="win32"
        runtime={runtime}
      />
    );
    const terminal = screen.getByLabelText('codex terminal');
    await waitFor(() => expect(xterm.focusTerminal).toHaveBeenCalled());
    xterm.focusTerminal.mockClear();

    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true
    });
    fireEvent(terminal, event);

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() =>
      expect(xterm.pasteTerminal).toHaveBeenCalledWith('from right click')
    );
    expect(readClipboardText).toHaveBeenCalledOnce();
    expect(xterm.focusTerminal).toHaveBeenCalledOnce();
  });

  it('does not paste empty clipboard text on right-click', async () => {
    const readClipboardText = vi.fn().mockResolvedValue('');
    installLumora({ readClipboardText });
    render(
      <ManagedTerminal
        active
        onRuntimeChange={vi.fn()}
        platform="linux"
        runtime={runtime}
      />
    );
    await waitFor(() => expect(xterm.customKeyEventHandler).not.toBeNull());

    fireEvent.contextMenu(screen.getByLabelText('codex terminal'));

    await waitFor(() => expect(readClipboardText).toHaveBeenCalledOnce());
    expect(xterm.pasteTerminal).not.toHaveBeenCalled();
  });

  it('reports right-click clipboard failures inline', async () => {
    installLumora({
      readClipboardText: vi.fn().mockRejectedValue(new Error('read failed'))
    });
    render(
      <ManagedTerminal
        active
        onRuntimeChange={vi.fn()}
        platform="darwin"
        runtime={runtime}
      />
    );
    await waitFor(() => expect(xterm.customKeyEventHandler).not.toBeNull());

    fireEvent.contextMenu(screen.getByLabelText('codex terminal'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Clipboard text could not be pasted.'
    );
  });

  it('pastes clipboard text through xterm and restores active focus', async () => {
    const readClipboardText = vi.fn().mockResolvedValue('from clipboard');
    const api = installLumora({ readClipboardText });
    render(
      <ManagedTerminal
        active
        onRuntimeChange={vi.fn()}
        platform="win32"
        runtime={runtime}
      />
    );
    await waitFor(() => expect(xterm.customKeyEventHandler).not.toBeNull());
    await waitFor(() => expect(xterm.focusTerminal).toHaveBeenCalled());
    xterm.focusTerminal.mockClear();
    const event = clipboardKey('KeyV', { ctrlKey: true });

    let handled!: boolean;
    act(() => { handled = xterm.customKeyEventHandler!(event); });

    expect(handled).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(xterm.pasteTerminal).toHaveBeenCalledWith('from clipboard');
    });
    expect(readClipboardText).toHaveBeenCalledTimes(1);
    expect(api.writeRuntime).not.toHaveBeenCalled();
    expect(xterm.focusTerminal).toHaveBeenCalledTimes(1);
  });

  it('does not ask xterm to paste empty clipboard text', async () => {
    const readClipboardText = vi.fn().mockResolvedValue('');
    installLumora({ readClipboardText });
    render(
      <ManagedTerminal
        active
        onRuntimeChange={vi.fn()}
        platform="win32"
        runtime={runtime}
      />
    );
    await waitFor(() => expect(xterm.customKeyEventHandler).not.toBeNull());

    act(() => {
      xterm.customKeyEventHandler!(clipboardKey('KeyV', { ctrlKey: true }));
    });

    await waitFor(() => expect(readClipboardText).toHaveBeenCalledTimes(1));
    expect(xterm.pasteTerminal).not.toHaveBeenCalled();
  });

  it('reports clipboard read failures inline', async () => {
    installLumora({
      readClipboardText: vi.fn().mockRejectedValue(new Error('read failed'))
    });
    render(
      <ManagedTerminal
        active
        onRuntimeChange={vi.fn()}
        platform="win32"
        runtime={runtime}
      />
    );
    await waitFor(() => expect(xterm.customKeyEventHandler).not.toBeNull());

    act(() => {
      xterm.customKeyEventHandler!(clipboardKey('KeyV', { ctrlKey: true }));
    });

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Clipboard text could not be pasted.'
    );
  });

  it('reports clipboard write failures inline', async () => {
    installLumora({
      writeClipboardText: vi.fn().mockRejectedValue(new Error('write failed'))
    });
    xterm.hasSelection.mockReturnValue(true);
    xterm.getSelection.mockReturnValue('selected text');
    render(
      <ManagedTerminal
        active
        onRuntimeChange={vi.fn()}
        platform="win32"
        runtime={runtime}
      />
    );
    await waitFor(() => expect(xterm.customKeyEventHandler).not.toBeNull());

    act(() => {
      xterm.customKeyEventHandler!(clipboardKey('KeyC', { ctrlKey: true }));
    });

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Selected text could not be copied.'
    );
  });

  it('ignores clipboard reads that resolve after unmount', async () => {
    let resolveRead!: (value: string) => void;
    const readClipboardText = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveRead = resolve;
        })
    );
    installLumora({ readClipboardText });
    const { unmount } = render(
      <ManagedTerminal
        active
        onRuntimeChange={vi.fn()}
        platform="win32"
        runtime={runtime}
      />
    );
    await waitFor(() => expect(xterm.customKeyEventHandler).not.toBeNull());
    act(() => {
      xterm.customKeyEventHandler!(clipboardKey('KeyV', { ctrlKey: true }));
    });
    await waitFor(() => expect(readClipboardText).toHaveBeenCalledTimes(1));

    unmount();
    await act(async () => {
      resolveRead('late clipboard text');
    });

    expect(xterm.pasteTerminal).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ignores clipboard writes that reject after unmount', async () => {
    let rejectWrite!: (reason: unknown) => void;
    const writeClipboardText = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectWrite = reject;
        })
    );
    installLumora({ writeClipboardText });
    xterm.hasSelection.mockReturnValue(true);
    xterm.getSelection.mockReturnValue('selected text');
    const { unmount } = render(
      <ManagedTerminal
        active
        onRuntimeChange={vi.fn()}
        platform="win32"
        runtime={runtime}
      />
    );
    await waitFor(() => expect(xterm.customKeyEventHandler).not.toBeNull());
    act(() => {
      xterm.customKeyEventHandler!(clipboardKey('KeyC', { ctrlKey: true }));
    });
    await waitFor(() => expect(writeClipboardText).toHaveBeenCalledTimes(1));

    unmount();
    await act(async () => {
      rejectWrite(new Error('late failure'));
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('uses the latest platform without reconstructing the terminal', async () => {
    const readClipboardText = vi.fn().mockResolvedValue('from clipboard');
    const attachRuntime = vi.fn().mockResolvedValue({
      runtime,
      snapshot: '',
      outputSequence: 0
    });
    installLumora({ attachRuntime, readClipboardText });
    const onRuntimeChange = vi.fn();
    const { rerender } = render(
      <ManagedTerminal
        active
        onRuntimeChange={onRuntimeChange}
        platform="win32"
        runtime={runtime}
      />
    );
    await waitFor(() => expect(xterm.customKeyEventHandler).not.toBeNull());
    await waitFor(() => expect(attachRuntime).toHaveBeenCalledTimes(1));
    const handler = xterm.customKeyEventHandler!;

    rerender(
      <ManagedTerminal
        active
        onRuntimeChange={onRuntimeChange}
        platform="darwin"
        runtime={runtime}
      />
    );
    const event = clipboardKey('KeyV', { metaKey: true });
    let handled!: boolean;
    act(() => {
      handled = handler(event);
    });

    expect(handled).toBe(false);
    await waitFor(() => {
      expect(xterm.pasteTerminal).toHaveBeenCalledWith('from clipboard');
    });
    expect(xterm.customKeyEventHandler).toBe(handler);
    expect(xterm.terminalConstructed).toHaveBeenCalledTimes(1);
    expect(attachRuntime).toHaveBeenCalledTimes(1);
  });
});
