import { afterEach, describe, expect, it, vi } from 'vitest';

import { keepPageToolbarPinned } from './page-toolbar';

/** A page scrolled to `scrollTop` whose toolbar is drawn at `drawnTop` and would rest at `restingTop`. */
function page(options: { scrollTop: number; drawnTop: number; restingTop: number; toolbar?: boolean }): HTMLElement {
  const main = document.createElement('main');
  if (options.toolbar !== false) {
    const toolbar = document.createElement('div');
    toolbar.className = 'page-toolbar';
    vi.spyOn(toolbar, 'getBoundingClientRect').mockImplementation(() => {
      const top = toolbar.style.position === 'static' ? options.restingTop : options.drawnTop;
      return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) };
    });
    main.append(toolbar);
  }
  main.scrollTop = options.scrollTop;
  return main;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('keepPageToolbarPinned', () => {
  it('moves a page with a pinned toolbar to where the toolbar first pins', () => {
    // Pinned 14px under the top bar at 64 while it would rest 300px above it.
    const main = page({ scrollTop: 900, drawnTop: 78, restingTop: -222 });

    keepPageToolbarPinned(main);

    expect(main.scrollTop).toBe(600);
    // The toolbar pins again as before.
    expect(main.querySelector<HTMLElement>('.page-toolbar')!.style.position).toBe('');
  });

  it('leaves a page alone while its toolbar rests in it', () => {
    const main = page({ scrollTop: 40, drawnTop: 180, restingTop: 180 });

    keepPageToolbarPinned(main);

    expect(main.scrollTop).toBe(40);
  });

  it('leaves a page without a toolbar alone', () => {
    const main = page({ scrollTop: 40, drawnTop: 0, restingTop: 0, toolbar: false });

    keepPageToolbarPinned(main);

    expect(main.scrollTop).toBe(40);
  });
});
