import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type {
  AgentInteractionRoute,
  SessionSummary
} from '../../../shared/contracts';
import {
  SessionRouteChoiceProvider
} from './SessionRouteChoiceContext';
import { useSessionResumeContextMenu } from './useSessionResumeContextMenu';
import {
  TEST_LOCALIZATION_SNAPSHOT,
  TestLocalizationProvider
} from '../test/render-with-localization';

const session = {
  id: 'session-1',
  provider: 'codex',
  title: 'Review Lumora'
} as SessionSummary;

const snapshot = {
  ...TEST_LOCALIZATION_SNAPSHOT,
  messages: {
    ...TEST_LOCALIZATION_SNAPSHOT.messages,
    'terminal.direct.open-unified': 'Open in Unified UI',
    'terminal.direct.open-native-terminal': 'Open in native terminal',
    'terminal.direct.unified-checking': 'Checking Unified UI.',
    'terminal.direct.unified-unavailable': 'Unified UI unavailable.',
    'terminal.direct.unified-incompatible': 'Unified UI incompatible.',
    'terminal.direct.unified-failed': 'Unified UI check failed.',
    'terminal.direct.unified-timed-out': 'Unified UI check timed out.',
    'terminal.direct.unified-resume-unsupported': 'Unified UI cannot resume.'
  }
};

function capability(resumeSession = true) {
  return {
    providerId: 'codex' as const,
    integration: 'codex_app_server' as const,
    checkedAt: '2026-09-01T00:00:00.000Z',
    version: '1.0.0',
    state: 'verified' as const,
    capabilities: {
      newSession: true,
      resumeSession,
      history: true,
      streaming: true,
      toolActivity: true,
      approvals: true,
      cancellation: true,
      usage: true,
      attachments: false
    },
    issue: null
  };
}

function MenuHarness({
  disabledReason = null,
  onResume,
  onResumeOptions,
  running = false
}: {
  disabledReason?: string | null;
  onResume: (session: SessionSummary, route: AgentInteractionRoute) => void;
  onResumeOptions: (session: SessionSummary) => void;
  running?: boolean;
}): ReactNode {
  const menu = useSessionResumeContextMenu({ onResume, onResumeOptions });
  return (
    <>
      <button
        onContextMenu={(event: MouseEvent<HTMLButtonElement>) =>
          menu.openFromPointer(event, session, running, disabledReason)}
        onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) =>
          menu.openFromKeyboard(event, session, running, disabledReason)}
        type="button"
      >
        Session card
      </button>
      {menu.menu}
    </>
  );
}

function setup(options: { enabled?: boolean; resumeSession?: boolean } = {}) {
  const api = {
    getStructuredProviderPreferences: vi.fn().mockResolvedValue([{
      providerId: 'codex',
      useUnifiedWhenAvailable: options.enabled ?? true,
      executablePathOverride: null
    }, {
      providerId: 'claude',
      useUnifiedWhenAvailable: true,
      executablePathOverride: null
    }, {
      providerId: 'gemini',
      useUnifiedWhenAvailable: true,
      executablePathOverride: null
    }]),
    scanStructuredProviderCapabilities: vi.fn().mockResolvedValue([
      capability(options.resumeSession ?? true)
    ])
  };
  const onResume = vi.fn();
  const onResumeOptions = vi.fn();
  render(
    <TestLocalizationProvider snapshot={snapshot}>
      <SessionRouteChoiceProvider api={api}>
        <MenuHarness
          onResume={onResume}
          onResumeOptions={onResumeOptions}
        />
      </SessionRouteChoiceProvider>
    </TestLocalizationProvider>
  );
  return { api, onResume, onResumeOptions };
}

describe('useSessionResumeContextMenu', () => {
  it('offers strict Unified UI and native PTY actions without changing preferences', async () => {
    const { api, onResume } = setup();
    await waitFor(() => expect(api.getStructuredProviderPreferences).toHaveBeenCalled());

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Session card' }));
    await waitFor(() => expect(
      screen.getByRole('menuitem', { name: 'Open in Unified UI' })
    ).toBeEnabled());

    fireEvent.click(screen.getByRole('menuitem', { name: 'Open in Unified UI' }));
    expect(onResume).toHaveBeenCalledWith(session, 'unified');

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Session card' }));
    fireEvent.click(screen.getByRole('menuitem', {
      name: 'Open in native terminal'
    }));
    expect(onResume).toHaveBeenLastCalledWith(session, 'pty');
  });

  it('hides Unified UI when the saved preference is disabled', async () => {
    const { api } = setup({ enabled: false });
    await waitFor(() => expect(api.getStructuredProviderPreferences).toHaveBeenCalled());

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Session card' }));

    expect(screen.queryByRole('menuitem', { name: 'Open in Unified UI' }))
      .not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Open in native terminal' }))
      .toBeEnabled();
  });

  it('disables Unified UI with a bounded explanation when resume is unsupported', async () => {
    const { api } = setup({ resumeSession: false });
    await waitFor(() => expect(api.getStructuredProviderPreferences).toHaveBeenCalled());

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Session card' }));
    const item = await screen.findByRole('menuitem', {
      name: 'Open in Unified UI'
    });
    await waitFor(() => expect(item).toBeDisabled());
    expect(item).toHaveAttribute('aria-description', 'Unified UI cannot resume.');
  });

  it('shows only Open for a session already owned by a runtime', () => {
    const onResume = vi.fn();
    render(
      <TestLocalizationProvider snapshot={snapshot}>
        <MenuHarness
          onResume={onResume}
          onResumeOptions={vi.fn()}
          running
        />
      </TestLocalizationProvider>
    );

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Session card' }));

    expect(screen.getAllByRole('menuitem')).toHaveLength(1);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open' }));
    expect(onResume).toHaveBeenCalledWith(session, 'automatic');
  });

  it('exposes the same choices from Shift+F10', async () => {
    const { api } = setup();
    await waitFor(() => expect(api.getStructuredProviderPreferences).toHaveBeenCalled());

    fireEvent.keyDown(screen.getByRole('button', { name: 'Session card' }), {
      key: 'F10',
      shiftKey: true
    });

    expect(await screen.findByRole('menuitem', {
      name: 'Open in native terminal'
    })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Resume options…' }))
      .toBeInTheDocument();
  });
});
