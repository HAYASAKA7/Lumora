import { describe, expect, it } from 'vitest';

import {
  CHANGES_PANEL_DEFAULT_WIDTH,
  CHANGES_PANEL_MIN_WIDTH,
  CHANGES_PANEL_WIDTH_KEY,
  clampPanelWidth,
  readPanelWidth,
  writePanelWidth
} from './changes-panel-preference';

function memoryHost() {
  const values = new Map<string, string>();
  return {
    values,
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      }
    }
  };
}

const throwingHost = {
  localStorage: {
    getItem: (): string | null => {
      throw new Error('blocked');
    },
    setItem: (): void => {
      throw new Error('blocked');
    }
  }
};

describe('changes panel width preference', () => {
  it('remembers a width', () => {
    const host = memoryHost();
    expect(readPanelWidth(host)).toBe(CHANGES_PANEL_DEFAULT_WIDTH);
    writePanelWidth(host, 612.4);
    expect(host.values.get(CHANGES_PANEL_WIDTH_KEY)).toBe('612');
    expect(readPanelWidth(host)).toBe(612);
  });

  it('ignores stored values that are not usable widths', () => {
    const host = memoryHost();
    for (const value of ['abc', 'Infinity', String(CHANGES_PANEL_MIN_WIDTH - 1), '']) {
      host.values.set(CHANGES_PANEL_WIDTH_KEY, value);
      expect(readPanelWidth(host)).toBe(CHANGES_PANEL_DEFAULT_WIDTH);
    }
  });

  it('falls back when storage throws', () => {
    expect(readPanelWidth(throwingHost)).toBe(CHANGES_PANEL_DEFAULT_WIDTH);
    expect(() => writePanelWidth(throwingHost, 500)).not.toThrow();
  });

  it('clamps between the minimum and most of the available width', () => {
    expect(clampPanelWidth(100, 1000)).toBe(320);
    expect(clampPanelWidth(900, 1000)).toBe(700);
    expect(clampPanelWidth(500.6, 1000)).toBe(501);
    expect(clampPanelWidth(500, 300)).toBe(320);
  });
});
