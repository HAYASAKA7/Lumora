import {
  STRUCTURED_IMAGE_MAX_BYTES,
  STRUCTURED_IMAGE_MAX_DIMENSION,
  type StructuredImageMimeType
} from '../../../shared/contracts';

/**
 * What can be pasted, dropped or picked. Every one is decoded and re-encoded
 * before it is sent, so the agent only ever receives a PNG or a JPEG.
 */
export const ACCEPTED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp'
] as const;

/** Headroom under the per-image limit, for the encoder's variance. */
const PNG_BUDGET_BYTES = Math.floor(STRUCTURED_IMAGE_MAX_BYTES * 0.9);
const JPEG_QUALITY = 0.85;
/** Twice the composer's 64px thumbnail, so it stays sharp on a HiDPI screen. */
const PREVIEW_DIMENSION = 128;

export function isAcceptedImage(file: Pick<Blob, 'type'>): boolean {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type);
}

/** Scales a size so its longest side fits `max`, and never enlarges it. */
export function fitWithin(
  width: number,
  height: number,
  max: number = STRUCTURED_IMAGE_MAX_DIMENSION
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

export interface PreparedImage {
  mimeType: StructuredImageMimeType;
  data: Uint8Array<ArrayBuffer>;
  /**
   * A small data URL for the composer. The renderer's policy admits data
   * images and not blob URLs, and a thumbnail keeps the full image out of the
   * DOM.
   */
  previewUrl: string;
}

function drawnCanvas(
  bitmap: ImageBitmap,
  size: { width: number; height: number }
): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('The image could not be drawn.'); // i18n-ignore: never shown
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  return { canvas, context };
}

function encode(
  canvas: HTMLCanvasElement,
  type: StructuredImageMimeType,
  quality?: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error('The image could not be encoded.')); // i18n-ignore: never shown
      else resolve(blob);
    }, type, quality);
  });
}

/**
 * Turns a pasted, dropped or picked image into what an agent is sent: scaled
 * so its longest side fits, and encoded as PNG — or as JPEG when a photo would
 * be too large as a PNG, which is where a screenshot and a photograph part
 * ways. Decoding it here is also what rejects anything that is not an image.
 */
export async function prepareImage(file: Blob): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file);
  try {
    const size = fitWithin(bitmap.width, bitmap.height);
    const { canvas, context } = drawnCanvas(bitmap, size);

    let mimeType: StructuredImageMimeType = 'image/png';
    let blob = await encode(canvas, mimeType);
    if (blob.size > PNG_BUDGET_BYTES) {
      // JPEG has no transparency; put white behind what was transparent rather
      // than letting it turn black.
      context.globalCompositeOperation = 'destination-over';
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, size.width, size.height);
      mimeType = 'image/jpeg';
      blob = await encode(canvas, mimeType, JPEG_QUALITY);
    }
    if (blob.size > STRUCTURED_IMAGE_MAX_BYTES) {
      throw new Error('The image is too large.'); // i18n-ignore: never shown
    }
    const preview = drawnCanvas(
      bitmap,
      fitWithin(bitmap.width, bitmap.height, PREVIEW_DIMENSION)
    );
    return {
      mimeType,
      data: new Uint8Array(await blob.arrayBuffer()),
      previewUrl: preview.canvas.toDataURL('image/png')
    };
  } finally {
    bitmap.close();
  }
}
