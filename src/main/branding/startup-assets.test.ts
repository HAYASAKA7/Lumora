import { readFileSync, statSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const startupVideo = new URL(
  '../../renderer/src/assets/lumora-startup.mp4',
  import.meta.url
);
const startupPoster = new URL(
  '../../renderer/src/assets/lumora-startup-final.png',
  import.meta.url
);

describe('startup presentation assets', () => {
  it('bundles a non-empty MP4 with an extracted PNG final frame', () => {
    expect(statSync(startupVideo).size).toBeGreaterThan(100_000);
    expect(statSync(startupPoster).size).toBeGreaterThan(10_000);

    const videoHeader = readFileSync(startupVideo).subarray(4, 8).toString('ascii');
    const posterHeader = readFileSync(startupPoster).subarray(0, 8);

    expect(videoHeader).toBe('ftyp');
    expect([...posterHeader]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });
});
