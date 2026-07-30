import type { GeneralSettings } from '../shared/contracts';

export type WindowCloseAction = 'allow' | 'hide' | 'quit';

export function resolveWindowCloseAction({
  shutdownStarted,
  behavior
}: {
  shutdownStarted: boolean;
  behavior: GeneralSettings['windowCloseBehavior'];
}): WindowCloseAction {
  if (shutdownStarted) return 'allow';
  return behavior === 'hide_to_tray' ? 'hide' : 'quit';
}
