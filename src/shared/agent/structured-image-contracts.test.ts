import { describe, expect, it } from 'vitest';

import {
  STRUCTURED_IMAGE_MAX_BYTES,
  StructuredAgentActionSchema,
  StructuredImageStageRequestSchema
} from './contracts';

function prompt(text: string, attachmentTokens: readonly string[]) {
  return StructuredAgentActionSchema.safeParse({
    kind: 'prompt.submit',
    connectionId: 'connection-1',
    text,
    attachmentTokens
  });
}

describe('structured image contracts', () => {
  it('lets a prompt carry images without text', () => {
    // Pasting a screenshot and pressing Enter is a whole message.
    expect(prompt('', ['image-1']).success).toBe(true);
  });

  it('still refuses a prompt with neither text nor images', () => {
    expect(prompt('', []).success).toBe(false);
    expect(prompt('   ', []).success).toBe(false);
  });

  it('accepts a PNG or JPEG within the size limit', () => {
    for (const mimeType of ['image/png', 'image/jpeg']) {
      expect(StructuredImageStageRequestSchema.safeParse({
        connectionId: 'connection-1',
        mimeType,
        data: new Uint8Array([1, 2, 3])
      }).success, mimeType).toBe(true);
    }
  });

  it('refuses other types, empty data, oversized data and non-byte data', () => {
    const cases = [
      { mimeType: 'image/gif', data: new Uint8Array([1]) },
      { mimeType: 'image/png', data: new Uint8Array(0) },
      { mimeType: 'image/png', data: new Uint8Array(STRUCTURED_IMAGE_MAX_BYTES + 1) },
      { mimeType: 'image/png', data: [1, 2, 3] }
    ];
    for (const value of cases) {
      expect(StructuredImageStageRequestSchema.safeParse({
        connectionId: 'connection-1',
        ...value
      }).success, value.mimeType).toBe(false);
    }
  });
});
