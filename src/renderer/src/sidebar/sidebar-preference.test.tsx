import { describe, expect, it, vi } from 'vitest';

import {
  SIDEBAR_EXPANSION_STORAGE_KEY,
  readSidebarExpanded,
  writeSidebarExpanded
} from './sidebar-preference';

function createStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) {
    values.set(SIDEBAR_EXPANSION_STORAGE_KEY, initial);
  }
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    })
  };
}

function createHost(initial?: string) {
  return {
    localStorage: createStorage(initial)
  };
}

describe('sidebar preference', () => {
  it('reads the canonical expanded and collapsed values', () => {
    expect(readSidebarExpanded(createHost('collapsed'))).toBe(false);

    expect(readSidebarExpanded(createHost('expanded'))).toBe(true);
  });

  it('defaults to expanded for missing or invalid values', () => {
    expect(readSidebarExpanded(createHost())).toBe(true);

    expect(readSidebarExpanded(createHost('invalid'))).toBe(true);
  });

  it('writes canonical values for both states', () => {
    const host = createHost();

    writeSidebarExpanded(host, false);
    expect(host.localStorage.setItem).toHaveBeenLastCalledWith(
      SIDEBAR_EXPANSION_STORAGE_KEY,
      'collapsed'
    );

    writeSidebarExpanded(host, true);
    expect(host.localStorage.setItem).toHaveBeenLastCalledWith(
      SIDEBAR_EXPANSION_STORAGE_KEY,
      'expanded'
    );
  });

  it('falls back safely when browser storage is unavailable', () => {
    const host = {
      localStorage: {
        getItem: vi.fn(() => {
          throw new Error('blocked');
        }),
        setItem: vi.fn(() => {
          throw new Error('blocked');
        })
      }
    };

    expect(readSidebarExpanded(host)).toBe(true);
    expect(() => writeSidebarExpanded(host, false)).not.toThrow();
  });

  it('falls back safely when the browser blocks access to localStorage', () => {
    const getLocalStorage = vi.fn(() => {
      throw new Error('blocked');
    });
    const host = {
      get localStorage(): never {
        return getLocalStorage();
      }
    };

    expect(readSidebarExpanded(host)).toBe(true);
    expect(() => writeSidebarExpanded(host, false)).not.toThrow();
    expect(getLocalStorage).toHaveBeenCalledTimes(2);
  });
});
