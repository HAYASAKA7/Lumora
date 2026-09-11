import { describe, expect, it } from 'vitest';

import { fitWithin, isAcceptedImage } from './structured-image-attachments';

describe('structured image attachments', () => {
  it('accepts the image types a person pastes or drops, and nothing else', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
      expect(isAcceptedImage({ type }), type).toBe(true);
    }
    for (const type of ['image/svg+xml', 'application/pdf', 'text/plain', '']) {
      expect(isAcceptedImage({ type }), type).toBe(false);
    }
  });

  it('scales a large image so its longest side fits, keeping its shape', () => {
    expect(fitWithin(4_000, 3_000, 2_048)).toEqual({ width: 2_048, height: 1_536 });
    expect(fitWithin(1_000, 5_000, 2_048)).toEqual({ width: 410, height: 2_048 });
  });

  it('never enlarges an image that already fits', () => {
    expect(fitWithin(800, 600, 2_048)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(2_048, 10, 2_048)).toEqual({ width: 2_048, height: 10 });
  });

  it('keeps a very thin image at least one pixel wide', () => {
    expect(fitWithin(10_000, 1, 2_048)).toEqual({ width: 2_048, height: 1 });
  });
});
