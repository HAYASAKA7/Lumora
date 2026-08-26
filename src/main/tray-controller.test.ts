import { describe, expect, it, vi } from 'vitest';

import type { RuntimeSummary, SessionSummary } from '../shared/contracts';
import type { StructuredAgentRuntimeSummary } from '../shared/agent/contracts';
import { createTrayController } from './tray-controller';

describe('createTrayController', () => {
  it('keeps a native tray alive, refreshes its menu, and restores on click', () => {
    let trayClick: (() => void) | null = null;
    let visible = false;
    const tray = {
      setToolTip: vi.fn(),
      setContextMenu: vi.fn(),
      on: vi.fn((event: string, listener: () => void) => {
        if (event === 'click') trayClick = listener;
      }),
      destroy: vi.fn()
    };
    const buildMenu = vi.fn((template) => template);
    const onShowWindow = vi.fn();
    const controller = createTrayController({
      tray,
      buildMenu,
      getState: () => ({
        windowVisible: visible,
        runtimes: [] as RuntimeSummary[],
        structuredRuntimes: [] as StructuredAgentRuntimeSummary[],
        sessions: [] as SessionSummary[]
      }),
      getTranslator: () => ({
        t: (key: string, values?: Record<string, string | number>) => ({
          'shell.tray.show': 'Show Lumora',
          'shell.tray.hide': 'Hide Lumora',
          'shell.tray.running-agents': `Running agents: ${values?.count ?? 0}`,
          'shell.tray.recent-sessions': 'Recent sessions',
          'shell.tray.no-recent-sessions': 'No recent sessions',
          'shell.tray.exit': 'Exit Lumora'
        })[key] ?? key
      }),
      onShowWindow,
      onToggleWindow: vi.fn(),
      onResumeSession: vi.fn(),
      onExit: vi.fn()
    });

    expect(tray.setToolTip).toHaveBeenCalledWith('Lumora');
    expect(tray.setContextMenu).toHaveBeenCalledOnce();
    expect(buildMenu.mock.calls[0]![0][0]).toMatchObject({
      label: 'Show Lumora'
    });

    trayClick!();
    expect(onShowWindow).toHaveBeenCalledOnce();
    expect(controller).toBeDefined();
    expect(controller.refresh).toEqual(expect.any(Function));
    expect(controller.dispose).toEqual(expect.any(Function));
    expect(tray.on).toHaveBeenCalledWith('click', expect.any(Function));

    visible = true;
    controller.refresh();
    expect(tray.setContextMenu).toHaveBeenCalledTimes(2);
    expect(buildMenu.mock.calls[1]![0][0]).toMatchObject({
      label: 'Hide Lumora'
    });

    controller.dispose();
    expect(tray.destroy).toHaveBeenCalledOnce();
  });
});
