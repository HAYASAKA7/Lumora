import {
  ClipboardTextSchema,
  TerminalClipboardReadResultSchema,
  type LumoraWindowContext,
  type RuntimeSummary,
  type SystemInfo,
  type TerminalClipboardReadResult
} from '../../shared/contracts';
import {
  MAX_TERMINAL_IMAGE_BYTES,
  MAX_TERMINAL_IMAGE_DIMENSION
} from './terminal-image-stager';

interface NativeClipboardImage {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  toPNG(): Buffer;
}

interface TerminalClipboardTarget {
  platform: SystemInfo['platform'];
  listRuntimes(): readonly Pick<RuntimeSummary, 'id' | 'state'>[];
  stageImage(input: {
    runtimeId: string;
    png: Buffer;
    width: number;
    height: number;
    platform: SystemInfo['platform'];
  }): Promise<{ pasteText: string }>;
}

interface CreateTerminalClipboardServiceOptions {
  clipboard: {
    readImage(): NativeClipboardImage;
    readText(): string;
  };
  resolveTarget(context: LumoraWindowContext): TerminalClipboardTarget;
}

type TerminalClipboardServiceErrorCode =
  | 'TERMINAL_CLIPBOARD_RUNTIME_UNAVAILABLE'
  | 'TERMINAL_CLIPBOARD_IMAGE_INVALID'
  | 'TERMINAL_CLIPBOARD_OPERATION_FAILED';

export class TerminalClipboardServiceError extends Error {
  constructor(readonly code: TerminalClipboardServiceErrorCode) {
    super(code);
    this.name = 'TerminalClipboardServiceError';
  }
}

export function createTerminalClipboardService({
  clipboard,
  resolveTarget
}: CreateTerminalClipboardServiceOptions) {
  return Object.freeze({
    async read(
      context: LumoraWindowContext,
      runtimeId: string
    ): Promise<TerminalClipboardReadResult> {
      const target = resolveTarget(context);
      const runtime = target.listRuntimes().find((entry) => entry.id === runtimeId);
      if (
        runtime === undefined ||
        (runtime.state !== 'launching' && runtime.state !== 'running')
      ) {
        throw new TerminalClipboardServiceError(
          'TERMINAL_CLIPBOARD_RUNTIME_UNAVAILABLE'
        );
      }

      try {
        const image = clipboard.readImage();
        if (!image.isEmpty()) {
          const { width, height } = image.getSize();
          if (
            !Number.isSafeInteger(width) ||
            !Number.isSafeInteger(height) ||
            width <= 0 ||
            height <= 0 ||
            width > MAX_TERMINAL_IMAGE_DIMENSION ||
            height > MAX_TERMINAL_IMAGE_DIMENSION
          ) {
            throw new TerminalClipboardServiceError(
              'TERMINAL_CLIPBOARD_IMAGE_INVALID'
            );
          }
          const png = image.toPNG();
          if (png.length === 0 || png.length > MAX_TERMINAL_IMAGE_BYTES) {
            throw new TerminalClipboardServiceError(
              'TERMINAL_CLIPBOARD_IMAGE_INVALID'
            );
          }
          const staged = await target.stageImage({
            runtimeId,
            png,
            width,
            height,
            platform: target.platform
          });
          return TerminalClipboardReadResultSchema.parse({
            kind: 'image',
            pasteText: staged.pasteText
          });
        }

        const text = ClipboardTextSchema.parse(clipboard.readText());
        return text.length === 0
          ? { kind: 'empty' }
          : { kind: 'text', text };
      } catch (error) {
        if (error instanceof TerminalClipboardServiceError) throw error;
        throw new TerminalClipboardServiceError(
          'TERMINAL_CLIPBOARD_OPERATION_FAILED'
        );
      }
    }
  });
}

export type TerminalClipboardService = ReturnType<
  typeof createTerminalClipboardService
>;
