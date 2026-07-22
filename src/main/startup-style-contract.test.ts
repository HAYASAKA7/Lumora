import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/styles.css'),
  'utf8'
);

describe('startup presentation style contract', () => {
  it('centers a responsive 16:9 stage over a video-aligned sampled gradient', () => {
    const overlayRule = stylesheet.match(
      /\.startup-overlay\s*\{([^}]*)\}/
    )?.[1];
    const backdropRule = stylesheet.match(
      /\.startup-overlay::before\s*\{([^}]*)\}/
    )?.[1];
    const stageRule = stylesheet.match(
      /\.startup-media-stage\s*\{([^}]*)\}/
    )?.[1];
    const mediaRule = stylesheet.match(
      /\.startup-media\s*\{([^}]*)\}/
    )?.[1];

    expect(overlayRule).toContain(
      '--startup-media-width: min(72vw, 1920px, calc((100vh - 32px) * 16 / 9))'
    );
    expect(overlayRule).toContain('display: grid');
    expect(overlayRule).toContain('place-items: center');
    expect(overlayRule).toContain(
      'transition: opacity var(--startup-fade-duration, 500ms)'
    );
    expect(overlayRule).toContain('will-change: opacity');
    expect(backdropRule).toContain(
      'height: calc(var(--startup-media-width) * 9 / 16)'
    );
    expect(backdropRule).toContain('#040c15 0%');
    expect(backdropRule).toContain('#01090e 50%');
    expect(backdropRule).toContain('#01040b 100%');
    expect(stageRule).toContain('width: var(--startup-media-width)');
    expect(stageRule).toContain('aspect-ratio: 16 / 9');
    expect(stageRule).toContain('margin: 0');
    expect(stageRule).not.toContain('margin-left: auto');
    expect(mediaRule).toContain('object-fit: contain');
  });
});
