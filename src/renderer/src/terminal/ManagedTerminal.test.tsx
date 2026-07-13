import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  RuntimeAttachment,
  RuntimeEvent,
  RuntimeSummary
} from '../../../shared/contracts';
import { ManagedTerminal } from './ManagedTerminal';

const { terminalWrite } = vi.hoisted(() => ({ terminalWrite: vi.fn() }));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit(): void {}
  }
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    parser = { registerOscHandler: vi.fn() };
    loadAddon(): void {}
    open(): void {}
    onData(): { dispose(): void } { return { dispose() {} }; }
    onResize(): { dispose(): void } { return { dispose() {} }; }
    write(data: string): void { terminalWrite(data); }
    focus(): void {}
    dispose(): void {}
  }
}));

const runtime: RuntimeSummary = {
  id: '0198f8b6-18f3-7ca0-9f0f-123456789abc',
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

describe('ManagedTerminal', () => {
  it('bounds the observed xterm target to a responsive viewport height', () => {
    Object.defineProperty(window, 'lumora', {
      configurable: true,
      value: {
        attachRuntime: vi.fn(() => new Promise(() => undefined)),
        onRuntimeEvent: vi.fn(() => () => undefined),
        resizeRuntime: vi.fn().mockResolvedValue(undefined),
        writeRuntime: vi.fn().mockResolvedValue(undefined)
      }
    });

    render(<ManagedTerminal onRuntimeChange={vi.fn()} runtime={runtime} />);

    expect(screen.getByLabelText('codex terminal')).toHaveStyle({
      blockSize: 'clamp(360px, 55vh, 620px)'
    });
  });

  it('writes attachment output once when a live event is already in the snapshot', async () => {
    terminalWrite.mockClear();
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
    Object.defineProperty(window, 'lumora', {
      configurable: true,
      value: {
        attachRuntime,
        onRuntimeEvent,
        resizeRuntime: vi.fn().mockResolvedValue(undefined),
        writeRuntime: vi.fn().mockResolvedValue(undefined)
      }
    });

    render(<ManagedTerminal onRuntimeChange={vi.fn()} runtime={runtime} />);
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

    await waitFor(() => expect(terminalWrite).toHaveBeenCalledTimes(1));
    expect(terminalWrite).toHaveBeenLastCalledWith('ready\r\n');

    act(() => {
      emitRuntime({
        type: 'output',
        runtimeId: runtime.id,
        sequence: 2,
        data: 'next\r\n'
      });
    });
    expect(terminalWrite).toHaveBeenCalledTimes(2);
    expect(terminalWrite).toHaveBeenLastCalledWith('next\r\n');
  });
});
