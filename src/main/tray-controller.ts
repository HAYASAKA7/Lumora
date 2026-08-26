import type { RuntimeSummary, SessionSummary } from '../shared/contracts';
import type { StructuredAgentRuntimeSummary } from '../shared/agent/contracts';
import { buildTrayMenuTemplate, type TrayMenuItem } from './tray-menu';

interface TrayPort {
  setToolTip(value: string): void;
  setContextMenu(menu: unknown): void;
  on(event: 'click', listener: () => void): void;
  destroy(): void;
}

interface TrayState {
  windowVisible: boolean;
  runtimes: readonly RuntimeSummary[];
  structuredRuntimes: readonly StructuredAgentRuntimeSummary[];
  sessions: readonly SessionSummary[];
}

interface CreateTrayControllerOptions {
  tray: TrayPort;
  buildMenu(template: TrayMenuItem[]): unknown;
  getState(): TrayState;
  getTranslator(): {
    t(key: string, values?: Record<string, string | number>): string;
  };
  onShowWindow(): void;
  onToggleWindow(): void;
  onResumeSession(sessionId: string): void;
  onExit(): void;
}

export interface TrayController {
  refresh(): void;
  dispose(): void;
}

export function createTrayController({
  tray,
  buildMenu,
  getState,
  getTranslator,
  onShowWindow,
  onToggleWindow,
  onResumeSession,
  onExit
}: CreateTrayControllerOptions): TrayController {
  let disposed = false;
  const refresh = () => {
    if (disposed) return;
    tray.setContextMenu(buildMenu(buildTrayMenuTemplate({
      ...getState(),
      translate: (key, values) => getTranslator().t(key, values),
      onToggleWindow,
      onResumeSession,
      onExit
    })));
  };

  tray.setToolTip('Lumora');
  tray.on('click', onShowWindow);
  refresh();

  return {
    refresh,
    dispose() {
      if (disposed) return;
      disposed = true;
      tray.destroy();
    }
  };
}
