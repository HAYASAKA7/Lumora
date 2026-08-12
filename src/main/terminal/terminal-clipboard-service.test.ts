import { describe, expect, it, vi } from 'vitest';

import type { LumoraWindowContext, RuntimeState } from '../../shared/contracts';
import {
  createTerminalClipboardService,
  TerminalClipboardServiceError
} from './terminal-clipboard-service';

const runtimeId = '5a795d90-06b3-4fca-b9a7-c0d0bf312c1d';
const context: LumoraWindowContext = { mode: 'local', executionTargetId: 'local' };

function harness(options: {
  imageEmpty?: boolean;
  text?: string;
  width?: number;
  height?: number;
  png?: Buffer;
  runtimes?: readonly { id: string; state: RuntimeState }[];
} = {}) {
  const image = {
    isEmpty: vi.fn(() => options.imageEmpty ?? true),
    getSize: vi.fn(() => ({
      width: options.width ?? 320,
      height: options.height ?? 200
    })),
    toPNG: vi.fn(() => options.png ?? Buffer.from('png'))
  };
  const clipboard = {
    readImage: vi.fn(() => image),
    readText: vi.fn(() => options.text ?? '')
  };
  const runtimes: readonly { id: string; state: RuntimeState }[] =
    options.runtimes ?? [{ id: runtimeId, state: 'running' }];
  const target = {
    platform: 'win32' as const,
    listRuntimes: vi.fn(() => runtimes),
    stageImage: vi.fn().mockResolvedValue({
      pasteText: '[Pasted image: "C:\\Temp\\image.png"]'
    })
  };
  const resolveTarget = vi.fn(() => target);
  return {
    service: createTerminalClipboardService({ clipboard, resolveTarget }),
    clipboard,
    image,
    target,
    resolveTarget
  };
}

describe('createTerminalClipboardService', () => {
  it('prefers a native image over clipboard text fallback without returning bytes', async () => {
    const { service, clipboard, target } = harness({
      imageEmpty: false,
      text: 'fallback text',
      png: Buffer.from('png')
    });

    await expect(service.read(context, runtimeId)).resolves.toEqual({
      kind: 'image',
      pasteText: '[Pasted image: "C:\\Temp\\image.png"]'
    });
    expect(target.stageImage).toHaveBeenCalledWith({
      runtimeId,
      png: Buffer.from('png'),
      width: 320,
      height: 200,
      platform: 'win32'
    });
    expect(clipboard.readText).not.toHaveBeenCalled();
  });

  it('returns bounded text or empty when no image exists', async () => {
    const text = harness({ text: 'plain clipboard' });
    await expect(text.service.read(context, runtimeId)).resolves.toEqual({
      kind: 'text', text: 'plain clipboard'
    });

    const empty = harness();
    await expect(empty.service.read(context, runtimeId)).resolves.toEqual({ kind: 'empty' });
  });

  it('rejects a runtime that is missing, ended, or owned by another target', async () => {
    const missing = harness({ runtimes: [] });
    await expect(missing.service.read(context, runtimeId)).rejects.toMatchObject({
      code: 'TERMINAL_CLIPBOARD_RUNTIME_UNAVAILABLE'
    });
    expect(missing.clipboard.readImage).not.toHaveBeenCalled();

    const ended = harness({ runtimes: [{ id: runtimeId, state: 'completed' }] });
    await expect(ended.service.read(context, runtimeId)).rejects.toBeInstanceOf(
      TerminalClipboardServiceError
    );
  });

  it('rejects oversized dimensions and encoded data before staging', async () => {
    const dimensions = harness({ imageEmpty: false, width: 8193 });
    await expect(dimensions.service.read(context, runtimeId)).rejects.toMatchObject({
      code: 'TERMINAL_CLIPBOARD_IMAGE_INVALID'
    });
    expect(dimensions.target.stageImage).not.toHaveBeenCalled();

    const bytes = harness({ imageEmpty: false, png: Buffer.alloc(20 * 1024 * 1024 + 1) });
    await expect(bytes.service.read(context, runtimeId)).rejects.toMatchObject({
      code: 'TERMINAL_CLIPBOARD_IMAGE_INVALID'
    });
    expect(bytes.target.stageImage).not.toHaveBeenCalled();
  });
});
