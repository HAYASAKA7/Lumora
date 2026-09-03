import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

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

afterEach(() => cleanup());
