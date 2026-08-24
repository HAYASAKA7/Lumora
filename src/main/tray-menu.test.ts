import { describe, expect, it, vi } from 'vitest';

import type { RuntimeSummary, SessionSummary } from '../shared/contracts';
import { buildTrayMenuTemplate } from './tray-menu';

const session = (index: number): SessionSummary => ({
  id: index.toString(16).padStart(64, 'a'),
  nativeId: `native-${index}`,
  provider: index % 2 === 0 ? 'codex' : 'claude',
  workspaceId: 'b'.repeat(64),
  title: `Session ${index}`,
  createdAt: `2026-07-${String(index).padStart(2, '0')}T01:00:00.000Z`,
  updatedAt: `2026-07-${String(index).padStart(2, '0')}T02:00:00.000Z`,
  lifetimeTokens: null,
  lifecycle: 'saved',
  sourceFreshness: 'current'
});

const runtime = (state: RuntimeSummary['state']): RuntimeSummary => ({
  id: crypto.randomUUID(),
  displayName: 'Agent task',
  strategy: 'new',
  sessionId: null,
  nativeSessionId: null,
  reconciliationState: 'pending',
  provider: 'codex',
  workspaceId: 'b'.repeat(64),
  terminalProfileId: 'c'.repeat(64),
  launchHash: 'd'.repeat(64),
  state,
  pid: state === 'launching' || state === 'running' ? 42 : null,
  createdAt: '2026-07-30T01:00:00.000Z',
  startedAt: state === 'launching' ? null : '2026-07-30T01:00:01.000Z',
  endedAt: state === 'completed' || state === 'failed'
    ? '2026-07-30T01:01:00.000Z'
    : null,
  exitCode: state === 'completed' ? 0 : null,
  errorCode: state === 'failed' ? 'PTY_RUNTIME_FAILED' : null
});

const englishTrayText: Record<string, string> = {
  'shell.tray.show': 'Show Lumora',
  'shell.tray.hide': 'Hide Lumora',
  'shell.tray.running-agents': 'Running agents: {count}',
  'shell.tray.recent-sessions': 'Recent sessions',
  'shell.tray.no-recent-sessions': 'No recent sessions',
  'shell.tray.running-suffix': 'Running',
  'shell.tray.exit': 'Exit Lumora'
};
const translate = (key: string, values?: Record<string, string | number>) =>
  (englishTrayText[key] ?? key).replace('{count}', String(values?.count ?? ''));

describe('buildTrayMenuTemplate', () => {
  it('uses the active translator for Lumora-owned tray text', () => {
    const translations: Record<string, string> = {
      'shell.tray.show': 'Lumora を表示',
      'shell.tray.running-agents': '実行中のエージェント: 0',
      'shell.tray.recent-sessions': '最近のセッション',
      'shell.tray.no-recent-sessions': '最近のセッションはありません',
      'shell.tray.exit': 'Lumora を終了'
    };
    const menu = buildTrayMenuTemplate({
      windowVisible: false,
      runtimes: [],
      sessions: [],
      translate: (key) => translations[key] ?? key,
      onToggleWindow: vi.fn(),
      onResumeSession: vi.fn(),
      onExit: vi.fn()
    });

    expect(menu[0]).toMatchObject({ label: 'Lumora を表示' });
    expect(menu[2]).toMatchObject({ label: '実行中のエージェント: 0' });
    expect(menu[3]).toMatchObject({ label: '最近のセッション' });
    expect(menu.at(-1)).toMatchObject({ label: 'Lumora を終了' });
  });
  it('shows window visibility and counts only live agent runtimes', () => {
    const onToggleWindow = vi.fn();
    const menu = buildTrayMenuTemplate({
      windowVisible: false,
      runtimes: [runtime('launching'), runtime('running'), runtime('completed')],
      sessions: [],
      translate,
      onToggleWindow,
      onResumeSession: vi.fn(),
      onExit: vi.fn()
    });

    expect(menu[0]).toMatchObject({ label: 'Show Lumora' });
    menu[0]!.click?.();
    expect(onToggleWindow).toHaveBeenCalledOnce();
    expect(menu[2]).toMatchObject({ label: 'Running agents: 2', enabled: false });
    expect(menu[3]).toMatchObject({ label: 'Recent sessions' });
    expect(menu[3]!.submenu).toEqual([
      expect.objectContaining({ label: 'No recent sessions', enabled: false })
    ]);
  });

  it('lists the five newest sessions and opens the selected resume confirmation', () => {
    const onResumeSession = vi.fn();
    const menu = buildTrayMenuTemplate({
      windowVisible: true,
      runtimes: [],
      sessions: [1, 2, 3, 4, 5, 6].map(session),
      translate,
      onToggleWindow: vi.fn(),
      onResumeSession,
      onExit: vi.fn()
    });

    expect(menu[0]).toMatchObject({ label: 'Hide Lumora' });
    const recent = menu[3]!.submenu!;
    expect(recent).toHaveLength(5);
    expect(recent.map((item) => item.label)).toEqual([
      'Session 6 · Codex',
      'Session 5 · Claude Code',
      'Session 4 · Codex',
      'Session 3 · Claude Code',
      'Session 2 · Codex'
    ]);

    recent[1]!.click?.();
    expect(onResumeSession).toHaveBeenCalledWith(session(5).id);
  });

  it('marks recent sessions that already have a running terminal', () => {
    const running = {
      ...runtime('running'),
      sessionId: session(2).id,
      nativeSessionId: session(2).nativeId,
      reconciliationState: 'linked' as const
    };
    const menu = buildTrayMenuTemplate({
      windowVisible: true,
      runtimes: [running],
      sessions: [session(1), session(2)],
      translate,
      onToggleWindow: vi.fn(),
      onResumeSession: vi.fn(),
      onExit: vi.fn()
    });

    expect(menu[3]!.submenu!.map((item) => item.label)).toEqual([
      'Session 2 · Codex · Running',
      'Session 1 · Claude Code'
    ]);
  });

  it('provides an explicit exit action', () => {
    const onExit = vi.fn();
    const menu = buildTrayMenuTemplate({
      windowVisible: true,
      runtimes: [],
      sessions: [],
      translate,
      onToggleWindow: vi.fn(),
      onResumeSession: vi.fn(),
      onExit
    });

    expect(menu.at(-1)).toMatchObject({ label: 'Exit Lumora' });
    menu.at(-1)!.click?.();
    expect(onExit).toHaveBeenCalledOnce();
  });
});
