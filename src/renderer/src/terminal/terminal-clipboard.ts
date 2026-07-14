import type { SystemInfo } from '../../../shared/contracts';

export type TerminalClipboardAction = 'copy' | 'paste' | 'terminal';

export function classifyTerminalClipboardKey(
  event: KeyboardEvent,
  platform: SystemInfo['platform'],
  hasSelection: boolean
): TerminalClipboardAction {
  if (event.type !== 'keydown' || event.altKey) return 'terminal';

  const controlAlias = event.ctrlKey && event.shiftKey && !event.metaKey;
  if (controlAlias && event.code === 'KeyC') return 'copy';
  if (controlAlias && event.code === 'KeyV') return 'paste';

  if (platform === 'darwin') {
    if (!event.ctrlKey && !event.shiftKey && event.metaKey) {
      if (event.code === 'KeyC') return 'copy';
      if (event.code === 'KeyV') return 'paste';
    }
    return 'terminal';
  }

  if (event.ctrlKey && !event.shiftKey && !event.metaKey) {
    if (event.code === 'KeyC') return hasSelection ? 'copy' : 'terminal';
    if (event.code === 'KeyV') return 'paste';
  }
  return 'terminal';
}
