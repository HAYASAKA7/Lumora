import { describe, expect, it } from 'vitest';

import {
  HelperFrameProtocolError,
  RemoteHelperResponseTracker,
  createHelperFrameDecoder,
  encodeHelperFrame
} from './helper-frame-codec';

describe('remote helper frame codec', () => {
  it('decodes fragmented and coalesced length-prefixed frames', () => {
    const first = encodeHelperFrame({ message: 'first' });
    const second = encodeHelperFrame({ message: 'second' });
    const decoder = createHelperFrameDecoder({ maxFrameBytes: 256 });

    expect(decoder.push(first.subarray(0, 3))).toEqual([]);
    expect(decoder.push(Buffer.concat([first.subarray(3), second]))).toEqual([
      { message: 'first' },
      { message: 'second' }
    ]);
  });

  it('rejects empty, oversized, malformed, and trailing incomplete frames', () => {
    const empty = Buffer.alloc(4);
    const oversized = Buffer.alloc(4);
    oversized.writeUInt32BE(257);
    const malformedPayload = Buffer.from('{not-json', 'utf8');
    const malformed = Buffer.alloc(4 + malformedPayload.length);
    malformed.writeUInt32BE(malformedPayload.length);
    malformedPayload.copy(malformed, 4);

    expect(() => createHelperFrameDecoder({ maxFrameBytes: 256 }).push(empty))
      .toThrow(HelperFrameProtocolError);
    expect(() => createHelperFrameDecoder({ maxFrameBytes: 256 }).push(oversized))
      .toThrow(/frame size/i);
    expect(() => createHelperFrameDecoder({ maxFrameBytes: 256 }).push(malformed))
      .toThrow(/JSON/i);

    const decoder = createHelperFrameDecoder({ maxFrameBytes: 256 });
    decoder.push(encodeHelperFrame({ ok: true }).subarray(0, 5));
    expect(() => decoder.finish()).toThrow(/incomplete/i);
  });

  it('rejects further input after a protocol failure', () => {
    const decoder = createHelperFrameDecoder({ maxFrameBytes: 8 });
    const oversized = Buffer.alloc(4);
    oversized.writeUInt32BE(9);
    expect(() => decoder.push(oversized)).toThrow();
    expect(() => decoder.push(Buffer.alloc(0))).toThrow(/failed/i);
  });

  it('rejects stale, unknown, and duplicated responses', () => {
    const tracker = new RemoteHelperResponseTracker(7);
    tracker.register('request-1');

    expect(() => tracker.accept({ generation: 6, requestId: 'request-1' }))
      .toThrow(/stale/i);
    expect(() => tracker.accept({ generation: 7, requestId: 'unknown' }))
      .toThrow(/unknown/i);
    expect(tracker.accept({ generation: 7, requestId: 'request-1' })).toBe(true);
    expect(() => tracker.accept({ generation: 7, requestId: 'request-1' }))
      .toThrow(/duplicate/i);
  });

  it('ignores one late response after a request timeout', () => {
    const tracker = new RemoteHelperResponseTracker(7);
    tracker.register('request-1');
    expect(tracker.expire('request-1')).toBe(true);
    expect(tracker.accept({ generation: 7, requestId: 'request-1' })).toBe(false);
  });
});
