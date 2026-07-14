import { describe, expect, it } from 'vitest';

import type { SystemInfo } from '../../../shared/contracts';
import { classifyTerminalClipboardKey } from './terminal-clipboard';

function key(
  code: string,
  modifiers: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>> = {},
  type = 'keydown'
): KeyboardEvent {
  return new KeyboardEvent(type, { code, ...modifiers });
}

type Platform = SystemInfo['platform'];

interface ClipboardCase {
  name: string;
  platform: Platform;
  event: KeyboardEvent;
  hasSelection: boolean;
  expected: 'copy' | 'paste' | 'terminal';
}

const cases: ClipboardCase[] = [
  {
    name: 'copies a Windows Ctrl+C selection',
    platform: 'win32',
    event: key('KeyC', { ctrlKey: true }),
    hasSelection: true,
    expected: 'copy'
  },
  {
    name: 'preserves Windows Ctrl+C interrupt without a selection',
    platform: 'win32',
    event: key('KeyC', { ctrlKey: true }),
    hasSelection: false,
    expected: 'terminal'
  },
  {
    name: 'copies a Linux Ctrl+C selection',
    platform: 'linux',
    event: key('KeyC', { ctrlKey: true }),
    hasSelection: true,
    expected: 'copy'
  },
  {
    name: 'preserves Linux Ctrl+C interrupt without a selection',
    platform: 'linux',
    event: key('KeyC', { ctrlKey: true }),
    hasSelection: false,
    expected: 'terminal'
  },
  {
    name: 'pastes with Windows Ctrl+V',
    platform: 'win32',
    event: key('KeyV', { ctrlKey: true }),
    hasSelection: false,
    expected: 'paste'
  },
  {
    name: 'pastes with Linux Ctrl+V',
    platform: 'linux',
    event: key('KeyV', { ctrlKey: true }),
    hasSelection: false,
    expected: 'paste'
  },
  {
    name: 'copies with macOS Cmd+C when text is selected',
    platform: 'darwin',
    event: key('KeyC', { metaKey: true }),
    hasSelection: true,
    expected: 'copy'
  },
  {
    name: 'consumes macOS Cmd+C without a selection',
    platform: 'darwin',
    event: key('KeyC', { metaKey: true }),
    hasSelection: false,
    expected: 'copy'
  },
  {
    name: 'pastes with macOS Cmd+V',
    platform: 'darwin',
    event: key('KeyV', { metaKey: true }),
    hasSelection: false,
    expected: 'paste'
  },
  {
    name: 'leaves macOS plain Ctrl+C to the terminal even with a selection',
    platform: 'darwin',
    event: key('KeyC', { ctrlKey: true }),
    hasSelection: true,
    expected: 'terminal'
  },
  {
    name: 'leaves macOS plain Ctrl+V to the terminal',
    platform: 'darwin',
    event: key('KeyV', { ctrlKey: true }),
    hasSelection: false,
    expected: 'terminal'
  },
  ...(['win32', 'linux', 'darwin'] as const).flatMap((platform): ClipboardCase[] => [
    {
      name: `copies with the ${platform} Ctrl+Shift+C alias without a selection`,
      platform,
      event: key('KeyC', { ctrlKey: true, shiftKey: true }),
      hasSelection: false,
      expected: 'copy'
    },
    {
      name: `pastes with the ${platform} Ctrl+Shift+V alias`,
      platform,
      event: key('KeyV', { ctrlKey: true, shiftKey: true }),
      hasSelection: false,
      expected: 'paste'
    }
  ]),
  {
    name: 'rejects Alt-modified native shortcuts',
    platform: 'win32',
    event: key('KeyC', { ctrlKey: true, altKey: true }),
    hasSelection: true,
    expected: 'terminal'
  },
  {
    name: 'rejects Alt-modified aliases',
    platform: 'darwin',
    event: key('KeyV', { ctrlKey: true, shiftKey: true, altKey: true }),
    hasSelection: false,
    expected: 'terminal'
  },
  {
    name: 'rejects mixed Ctrl+Meta shortcuts',
    platform: 'darwin',
    event: key('KeyC', { ctrlKey: true, metaKey: true }),
    hasSelection: true,
    expected: 'terminal'
  },
  {
    name: 'rejects unrelated keys',
    platform: 'linux',
    event: key('KeyX', { ctrlKey: true }),
    hasSelection: true,
    expected: 'terminal'
  },
  {
    name: 'rejects non-keydown events',
    platform: 'win32',
    event: key('KeyV', { ctrlKey: true }, 'keyup'),
    hasSelection: false,
    expected: 'terminal'
  }
];

describe('classifyTerminalClipboardKey', () => {
  it.each(cases)('$name', ({ event, platform, hasSelection, expected }) => {
    expect(classifyTerminalClipboardKey(event, platform, hasSelection)).toBe(expected);
  });
});
