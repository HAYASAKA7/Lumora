import { describe, expect, it } from 'vitest';

import {
  defaultSidebarSessionSections,
  readSidebarSessionSections,
  writeSidebarSessionSections
} from './sidebar-session-preference';

function storageHost(initial: Readonly<Record<string, string>> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    host: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value)
      }
    },
    values
  };
}

describe('sidebar session section preferences', () => {
  it('defaults both target-scoped sections to expanded', () => {
    expect(readSidebarSessionSections(storageHost().host, 'local')).toEqual(
      defaultSidebarSessionSections()
    );
  });

  it('persists local and remote scopes independently', () => {
    const { host } = storageHost();
    writeSidebarSessionSections(host, 'local', {
      runningExpanded: false,
      recentExpanded: true
    });
    writeSidebarSessionSections(host, `remote:${'a'.repeat(64)}`, {
      runningExpanded: true,
      recentExpanded: false
    });

    expect(readSidebarSessionSections(host, 'local')).toEqual({
      runningExpanded: false,
      recentExpanded: true
    });
    expect(readSidebarSessionSections(host, `remote:${'a'.repeat(64)}`)).toEqual({
      runningExpanded: true,
      recentExpanded: false
    });
  });

  it('falls back for malformed values and blocked storage', () => {
    const invalid = storageHost({
      'lumora.ui.sidebar.sessions.v1:local': '{"runningExpanded":"no"}'
    });
    expect(readSidebarSessionSections(invalid.host, 'local')).toEqual(
      defaultSidebarSessionSections()
    );

    const blocked = {
      localStorage: {
        getItem: (_key: string): string | null => {
          throw new Error('blocked');
        },
        setItem: (_key: string, _value: string): void => {
          throw new Error('blocked');
        }
      }
    };
    expect(readSidebarSessionSections(blocked, 'local')).toEqual(
      defaultSidebarSessionSections()
    );
    expect(() => writeSidebarSessionSections(blocked, 'local', {
      runningExpanded: false,
      recentExpanded: false
    })).not.toThrow();
  });
});
