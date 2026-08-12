import { describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '../../shared/contracts';
import { registerClipboardIpc } from './register-clipboard-ipc';

type Handler = (
  event: { senderFrame: { url: string } | null },
  ...args: readonly unknown[]
) => Promise<unknown> | unknown;

function createHarness(options: {
  developmentOrigin?: string;
  readText?: () => string;
  writeText?: (text: string) => void;
  readTerminalClipboard?: (...args: any[]) => Promise<unknown>;
} = {}) {
  const handlers = new Map<string, Handler>();
  const ipc = {
    handle(channel: string, handler: Handler) {
      handlers.set(channel, handler);
    }
  };
  const clipboard = {
    readText: vi.fn(options.readText ?? (() => 'clipboard text')),
    writeText: vi.fn(options.writeText ?? (() => undefined))
  };
  const readTerminalClipboard = vi.fn(
    options.readTerminalClipboard ??
      (async () => ({ kind: 'text', text: 'terminal clipboard' }))
  );

  registerClipboardIpc({
    authorize: () => ({ mode: 'local', executionTargetId: 'local' }),
    ipc,
    clipboard,
    readTerminalClipboard,
    ...(options.developmentOrigin === undefined
      ? {}
      : { developmentOrigin: options.developmentOrigin })
  });

  return { handlers, clipboard, readTerminalClipboard };
}

const trustedEvent = {
  senderFrame: { url: 'app://lumora/index.html' }
};

const expectedAccessError = {
  code: 'IPC_UNTRUSTED_SENDER',
  message:
    'IPC_UNTRUSTED_SENDER: The IPC request did not originate from the Lumora renderer.'
};

const expectedClipboardError = {
  code: 'CLIPBOARD_OPERATION_FAILED',
  message:
    'CLIPBOARD_OPERATION_FAILED: Lumora could not complete the clipboard operation.'
};

describe('registerClipboardIpc', () => {
  it('registers only the three dedicated clipboard channels in order', () => {
    const { handlers } = createHarness();

    expect([...handlers.keys()]).toEqual([
      IPC_CHANNELS.clipboardTextRead,
      IPC_CHANNELS.clipboardTextWrite,
      IPC_CHANNELS.terminalClipboardRead
    ]);
  });

  it('reads terminal clipboard content for the target-owned runtime', async () => {
    const { handlers, readTerminalClipboard } = createHarness();
    const request = { runtimeId: '5a795d90-06b3-4fca-b9a7-c0d0bf312c1d' };

    await expect(
      handlers.get(IPC_CHANNELS.terminalClipboardRead)!(trustedEvent, request)
    ).resolves.toEqual({ kind: 'text', text: 'terminal clipboard' });
    expect(readTerminalClipboard).toHaveBeenCalledWith(
      { mode: 'local', executionTargetId: 'local' },
      request
    );
  });

  it('reads clipboard text for the trusted packaged renderer', async () => {
    const { handlers, clipboard } = createHarness({
      readText: () => 'copied text'
    });
    const read = handlers.get(IPC_CHANNELS.clipboardTextRead)!;

    await expect(read(trustedEvent)).resolves.toBe('copied text');
    expect(clipboard.readText).toHaveBeenCalledOnce();
  });

  it('writes clipboard text for the trusted packaged renderer', async () => {
    const { handlers, clipboard } = createHarness();
    const write = handlers.get(IPC_CHANNELS.clipboardTextWrite)!;

    await expect(write(trustedEvent, 'new text')).resolves.toEqual({
      accepted: true
    });
    expect(clipboard.writeText).toHaveBeenCalledOnce();
    expect(clipboard.writeText).toHaveBeenCalledWith('new text');
  });

  it('rejects an untrusted URL before either clipboard operation', async () => {
    const { handlers, clipboard } = createHarness();
    const untrustedEvent = {
      senderFrame: { url: 'https://example.com' }
    };

    await expect(
      handlers.get(IPC_CHANNELS.clipboardTextRead)!(untrustedEvent)
    ).rejects.toMatchObject(expectedAccessError);
    await expect(
      handlers.get(IPC_CHANNELS.clipboardTextWrite)!(
        untrustedEvent,
        'new text'
      )
    ).rejects.toMatchObject(expectedAccessError);
    await expect(
      handlers.get(IPC_CHANNELS.terminalClipboardRead)!(untrustedEvent, {
        runtimeId: '5a795d90-06b3-4fca-b9a7-c0d0bf312c1d'
      })
    ).rejects.toMatchObject(expectedAccessError);
    expect(clipboard.readText).not.toHaveBeenCalled();
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it('rejects a null sender frame before either clipboard operation', async () => {
    const { handlers, clipboard } = createHarness();
    const nullFrameEvent = { senderFrame: null };

    await expect(
      handlers.get(IPC_CHANNELS.clipboardTextRead)!(nullFrameEvent)
    ).rejects.toMatchObject(expectedAccessError);
    await expect(
      handlers.get(IPC_CHANNELS.clipboardTextWrite)!(
        nullFrameEvent,
        'new text'
      )
    ).rejects.toMatchObject(expectedAccessError);
    expect(clipboard.readText).not.toHaveBeenCalled();
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it('accepts the exact configured development origin', async () => {
    const { handlers, clipboard } = createHarness({
      developmentOrigin: 'http://localhost:5173'
    });
    const developmentEvent = {
      senderFrame: { url: 'http://localhost:5173/src/main.tsx' }
    };

    await expect(
      handlers.get(IPC_CHANNELS.clipboardTextRead)!(developmentEvent)
    ).resolves.toBe('clipboard text');
    await expect(
      handlers.get(IPC_CHANNELS.clipboardTextWrite)!(
        developmentEvent,
        'new text'
      )
    ).resolves.toEqual({ accepted: true });
    expect(clipboard.readText).toHaveBeenCalledOnce();
    expect(clipboard.writeText).toHaveBeenCalledWith('new text');
  });

  it('rejects oversized writes before native clipboard access', async () => {
    const { handlers, clipboard } = createHarness();
    const write = handlers.get(IPC_CHANNELS.clipboardTextWrite)!;

    await expect(
      write(trustedEvent, 'x'.repeat(4_194_305))
    ).rejects.toMatchObject({ name: 'ZodError' });
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it('normalizes native clipboard read failures without leaking details', async () => {
    const { handlers } = createHarness({
      readText: () => {
        throw new Error('native read failed at a private OS boundary');
      }
    });
    const read = handlers.get(IPC_CHANNELS.clipboardTextRead)!;
    const rejection = read(trustedEvent);

    await expect(rejection).rejects.toMatchObject(expectedClipboardError);
    await expect(rejection).rejects.not.toThrow('private OS boundary');
  });

  it('normalizes native clipboard write failures without leaking details', async () => {
    const { handlers, clipboard } = createHarness({
      writeText: () => {
        throw new Error('native write failed at a private OS boundary');
      }
    });
    const write = handlers.get(IPC_CHANNELS.clipboardTextWrite)!;
    const rejection = write(trustedEvent, 'new text');

    await expect(rejection).rejects.toMatchObject(expectedClipboardError);
    await expect(rejection).rejects.not.toThrow('private OS boundary');
    expect(clipboard.writeText).toHaveBeenCalledWith('new text');
  });
});
