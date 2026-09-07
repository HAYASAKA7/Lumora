import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

import { resolveAsyncUtilTimeout } from '../../shared/test-runner-config';

configure({ asyncUtilTimeout: resolveAsyncUtilTimeout(process.env.CI) });

/**
 * jsdom implements no layout, so it ships no `scrollIntoView`. Electron always
 * provides it, and a test that cares about scrolling replaces this stub with
 * its own spy.
 */
if (typeof HTMLElement.prototype.scrollIntoView !== 'function') {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => undefined,
    writable: true
  });
}

/**
 * jsdom implements no layout, so every element reports `clientHeight: 0` —
 * which production code correctly reads as "not displayed". Model the one rule
 * that matters: an element inside a hidden subtree has no height, anything
 * else has a plausible one. A test that needs an exact height still defines
 * `clientHeight` on its own element, and that own property wins over this.
 */
const RENDERED_ELEMENT_HEIGHT = 600;

Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
  configurable: true,
  get(this: HTMLElement): number {
    for (
      let node: HTMLElement | null = this;
      node !== null;
      node = node.parentElement
    ) {
      if (node.hidden || node.style.display === 'none') return 0;
    }
    return RENDERED_ELEMENT_HEIGHT;
  }
});

afterEach(() => cleanup());
