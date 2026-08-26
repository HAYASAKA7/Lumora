import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { RuntimeSummary, SessionSummary } from '../../../shared/contracts';
import {
  renderWithLocalization,
  TEST_LOCALIZATION_SNAPSHOT
} from '../test/render-with-localization';
import { TooltipProvider } from '../ui/Tooltip';
import { SidebarSessionList } from './SidebarSessionList';

const running: RuntimeSummary[] = [
  {
    id: '0198f8b6-18f3-7ca0-9f0f-123456789abc',
    displayName: 'Kokora lifecycle with a deliberately long session title',
    strategy: 'resume',
    sessionId: 'c'.repeat(64),
    nativeSessionId: 'native-codex',
    reconciliationState: 'not_required',
    provider: 'codex',
    workspaceId: 'a'.repeat(64),
    terminalProfileId: 'b'.repeat(64),
    launchHash: 'd'.repeat(64),
    state: 'running',
    pid: 42,
    createdAt: '2026-08-26T01:00:00.000Z',
    startedAt: '2026-08-26T01:00:01.000Z',
    endedAt: null,
    exitCode: null,
    errorCode: null
  },
  {
    id: '0198f8b6-18f3-7ca0-9f0f-123456789abd',
    displayName: 'Remote docs update',
    strategy: 'new',
    sessionId: null,
    nativeSessionId: null,
    reconciliationState: 'pending',
    provider: 'claude',
    workspaceId: 'a'.repeat(64),
    terminalProfileId: 'b'.repeat(64),
    launchHash: 'e'.repeat(64),
    state: 'launching',
    pid: 43,
    createdAt: '2026-08-26T01:05:00.000Z',
    startedAt: null,
    endedAt: null,
    exitCode: null,
    errorCode: null
  }
];

const recent: SessionSummary[] = [
  {
    id: 'e'.repeat(64),
    nativeId: 'recent-codex',
    provider: 'codex',
    workspaceId: 'a'.repeat(64),
    title: 'Theme mod support',
    createdAt: '2026-08-25T01:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
    lifetimeTokens: 200,
    lifecycle: 'saved',
    sourceFreshness: 'current'
  },
  {
    id: 'f'.repeat(64),
    nativeId: 'recent-claude',
    provider: 'claude',
    workspaceId: 'a'.repeat(64),
    title: 'API migration',
    createdAt: '2026-08-24T01:00:00.000Z',
    updatedAt: '2026-08-25T00:00:00.000Z',
    lifetimeTokens: null,
    lifecycle: 'saved',
    sourceFreshness: 'current'
  }
];

const snapshot = {
  ...TEST_LOCALIZATION_SNAPSHOT,
  messages: {
    ...TEST_LOCALIZATION_SNAPSHOT.messages,
    'shell.sidebar.sessions.running': 'Running sessions',
    'shell.sidebar.sessions.recent': 'Recent sessions',
    'shell.sidebar.sessions.collapse-running': 'Collapse running sessions',
    'shell.sidebar.sessions.expand-running': 'Expand running sessions',
    'shell.sidebar.sessions.collapse-recent': 'Collapse recent sessions',
    'shell.sidebar.sessions.expand-recent': 'Expand recent sessions',
    'shell.sidebar.sessions.no-running': 'No running sessions',
    'shell.sidebar.sessions.no-recent': 'No recent sessions'
  }
};

function renderList({
  onActivateRuntime = vi.fn(),
  onResumeSession = vi.fn(),
  recentSessions = recent
}: {
  onActivateRuntime?: (runtimeId: string) => void;
  onResumeSession?: (session: SessionSummary) => void;
  recentSessions?: readonly SessionSummary[];
} = {}) {
  const preferences = new Map<string, string>();
  renderWithLocalization(
    <TooltipProvider>
      <SidebarSessionList
        activeRuntimeId={running[0]!.id}
        onActivateRuntime={onActivateRuntime}
        onResumeSession={onResumeSession}
        preferenceHost={{
          localStorage: {
            getItem: (key) => preferences.get(key) ?? null,
            setItem: (key, value) => preferences.set(key, value)
          }
        }}
        preferenceScope="test-target"
        recent={recentSessions}
        running={running}
      />
    </TooltipProvider>,
    snapshot
  );
}

describe('SidebarSessionList', () => {
  it('renders independent running and recent regions with active state', () => {
    renderList();

    const runningRegion = screen.getByRole('region', { name: 'Running sessions' });
    const recentRegion = screen.getByRole('region', { name: 'Recent sessions' });
    expect(within(runningRegion).getAllByRole('button')).toHaveLength(2);
    expect(within(recentRegion).getAllByRole('button')).toHaveLength(2);
    expect(within(runningRegion).getByRole('button', {
      name: /Kokora lifecycle/
    })).toHaveAttribute('aria-current', 'true');
  });

  it('activates running terminals and opens recent sessions through callbacks', () => {
    const onActivateRuntime = vi.fn();
    const onResumeSession = vi.fn();
    renderList({ onActivateRuntime, onResumeSession });

    fireEvent.click(screen.getByRole('button', { name: /Remote docs update/ }));
    expect(onActivateRuntime).toHaveBeenCalledWith(running[1]!.id);

    fireEvent.click(screen.getByRole('button', { name: /Theme mod support/ }));
    expect(onResumeSession).toHaveBeenCalledWith(recent[0]);
  });

  it('collapses each section independently and persists the choice', () => {
    renderList();

    fireEvent.click(screen.getByRole('button', {
      name: 'Collapse running sessions'
    }));
    expect(screen.queryByRole('region', { name: 'Running sessions' }))
      .not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Recent sessions' })).toBeVisible();
    expect(screen.getByRole('button', {
      name: 'Expand running sessions'
    })).toHaveAttribute('aria-expanded', 'false');
  });

  it('does not expose sidebar drag behavior', () => {
    renderList();
    const row = screen.getByRole('button', { name: /Kokora lifecycle/ });
    expect(row).not.toHaveAttribute('draggable');
    expect(row).not.toHaveAttribute('aria-grabbed');
  });

  it('renders recent sessions progressively as its scroll area approaches the end', () => {
    const recentSessions = Array.from({ length: 65 }, (_, index) => ({
      ...recent[0]!,
      id: index.toString(16).padStart(64, '0'),
      nativeId: `recent-${index}`,
      title: `Recent session ${index + 1}`,
      updatedAt: new Date(Date.UTC(2026, 7, 26, 0, index)).toISOString()
    }));
    renderList({ recentSessions });

    const region = screen.getByRole('region', { name: 'Recent sessions' });
    expect(within(region).getAllByRole('button')).toHaveLength(30);
    Object.defineProperties(region, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 1_200 },
      scrollTop: { configurable: true, value: 780 }
    });

    fireEvent.scroll(region);

    expect(within(region).getAllByRole('button')).toHaveLength(60);
    fireEvent.scroll(region);
    expect(within(region).getAllByRole('button')).toHaveLength(65);
  });
});
