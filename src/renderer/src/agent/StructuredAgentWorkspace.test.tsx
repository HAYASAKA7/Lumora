import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  LumoraApi,
  StructuredAgentRuntimeSnapshot
} from '../../../shared/contracts';
import { renderWithLocalization } from '../test/render-with-localization';
import { StructuredAgentWorkspace } from './StructuredAgentWorkspace';

const snapshot: StructuredAgentRuntimeSnapshot = {
  runtime: {
    connectionId: 'connection-1',
    providerId: 'codex',
    nativeSessionId: 'native-1',
    catalogSessionId: 'session-1',
    workspaceId: 'workspace-1',
    title: 'Repository cleanup',
    state: 'ready',
    generation: 1,
    createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z',
    error: null
  },
  boundary: {
    kind: 'connection_start',
    message: 'Earlier history is owned by the provider.'
  },
  events: [
    {
      connectionId: 'connection-1', providerId: 'codex', nativeSessionId: 'native-1',
      turnId: 'turn-1', eventId: 'event-1', parentEventId: null, sequence: 1,
      generation: 1, timestamp: '2026-08-27T00:00:01.000Z', kind: 'user.message',
      payload: { text: 'Fix the tests.' }
    },
    {
      connectionId: 'connection-1', providerId: 'codex', nativeSessionId: 'native-1',
      turnId: 'turn-1', eventId: 'event-2', parentEventId: null, sequence: 2,
      generation: 1, timestamp: '2026-08-27T00:00:02.000Z', kind: 'assistant.message',
      payload: { text: 'The tests are fixed.' }
    },
    {
      connectionId: 'connection-1', providerId: 'codex', nativeSessionId: 'native-1',
      turnId: 'turn-1', eventId: 'event-3', parentEventId: null, sequence: 3,
      generation: 1, timestamp: '2026-08-27T00:00:03.000Z', kind: 'approval.requested',
      payload: {
        approvalId: 'approval-1', title: 'Run tests', detail: 'npm test',
        choices: ['allow_once', 'deny']
      }
    }
  ]
};

function renderWorkspace() {
  const dispatchStructuredAgentAction = vi.fn(async () => undefined);
  const onClose = vi.fn();
  const api = { dispatchStructuredAgentAction } as unknown as LumoraApi;
  renderWithLocalization(
    <StructuredAgentWorkspace
      activeConnectionId="connection-1"
      api={api}
      onActivate={vi.fn()}
      onClose={onClose}
      onReconnect={vi.fn()}
      snapshots={[snapshot]}
    />
  );
  return { dispatchStructuredAgentAction, onClose };
}

describe('StructuredAgentWorkspace', () => {
  it('exposes a close control for the active structured session', () => {
    const { onClose } = renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: 'Close session' }));
    expect(onClose).toHaveBeenCalledWith('connection-1');
  });

  it('renders provider-owned conversation history and dispatches approval actions', () => {
    const { dispatchStructuredAgentAction } = renderWorkspace();

    expect(screen.getByText('Fix the tests.')).toBeInTheDocument();
    expect(screen.getByText('The tests are fixed.')).toBeInTheDocument();
    expect(screen.queryByText('You')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
    expect(dispatchStructuredAgentAction).toHaveBeenCalledWith({
      kind: 'approval.respond',
      connectionId: 'connection-1',
      approvalId: 'approval-1',
      decision: 'allow_once'
    });
  });

  it('submits multiline prompts directly while preserving IME composition', () => {
    const { dispatchStructuredAgentAction } = renderWorkspace();
    const composer = screen.getByRole('textbox', { name: 'Message Codex' });
    fireEvent.change(composer, { target: { value: 'First line\nSecond line' } });
    fireEvent.compositionStart(composer);
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(dispatchStructuredAgentAction).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'prompt.submit' })
    );
    fireEvent.compositionEnd(composer);
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(dispatchStructuredAgentAction).toHaveBeenCalledWith({
      kind: 'prompt.submit',
      connectionId: 'connection-1',
      text: 'First line\nSecond line',
      attachmentTokens: []
    });
  });

  it('keeps the prompt composer independent from conversation message length', () => {
    renderWorkspace();
    const composer = screen.getByRole('textbox', { name: 'Message Codex' });
    expect(composer).toHaveAttribute('rows', '3');
    expect(composer).not.toHaveAttribute('style');
  });

  it('follows new conversation events until the user scrolls away', () => {
    const props = {
      api: {
        dispatchStructuredAgentAction: vi.fn(async () => undefined)
      } as unknown as LumoraApi,
      activeConnectionId: 'connection-1',
      onActivate: vi.fn(),
      onClose: vi.fn(),
      onReconnect: vi.fn()
    };
    const view = renderWithLocalization(
      <StructuredAgentWorkspace {...props} snapshots={[snapshot]} />
    );
    const body = document.querySelector('.structured-agent-body') as HTMLDivElement;
    let scrollHeight = 500;
    Object.defineProperty(body, 'clientHeight', { configurable: true, value: 100 });
    Object.defineProperty(body, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight
    });
    body.scrollTop = 400;
    fireEvent.scroll(body);

    scrollHeight = 700;
    const firstUpdate: StructuredAgentRuntimeSnapshot = {
      ...snapshot,
      events: [
        ...snapshot.events,
        {
          connectionId: 'connection-1', providerId: 'codex', nativeSessionId: 'native-1',
          turnId: 'turn-2', eventId: 'event-4', parentEventId: null, sequence: 4,
          generation: 1, timestamp: '2026-08-27T00:00:04.000Z', kind: 'turn.started',
          payload: { state: 'running', message: null }
        }
      ]
    };
    view.rerender(<StructuredAgentWorkspace {...props} snapshots={[firstUpdate]} />);
    expect(body.scrollTop).toBe(700);

    body.scrollTop = 240;
    fireEvent.scroll(body);
    scrollHeight = 900;
    const secondUpdate: StructuredAgentRuntimeSnapshot = {
      ...firstUpdate,
      events: [
        ...firstUpdate.events,
        {
          connectionId: 'connection-1', providerId: 'codex', nativeSessionId: 'native-1',
          turnId: 'turn-2', eventId: 'event-5', parentEventId: null, sequence: 5,
          generation: 1, timestamp: '2026-08-27T00:00:05.000Z', kind: 'assistant.delta',
          payload: { text: 'New output' }
        }
      ]
    };
    view.rerender(<StructuredAgentWorkspace {...props} snapshots={[secondUpdate]} />);
    expect(body.scrollTop).toBe(240);

    body.scrollTop = 800;
    fireEvent.scroll(body);
    scrollHeight = 1_000;
    const thirdUpdate: StructuredAgentRuntimeSnapshot = {
      ...secondUpdate,
      events: [
        ...secondUpdate.events,
        {
          connectionId: 'connection-1', providerId: 'codex', nativeSessionId: 'native-1',
          turnId: 'turn-2', eventId: 'event-6', parentEventId: null, sequence: 6,
          generation: 1, timestamp: '2026-08-27T00:00:06.000Z', kind: 'assistant.delta',
          payload: { text: ' after returning to the latest output' }
        }
      ]
    };
    view.rerender(<StructuredAgentWorkspace {...props} snapshots={[thirdUpdate]} />);
    expect(body.scrollTop).toBe(1_000);
  });

  it('keeps command output compact and collapsed until the user expands it', () => {
    const commandSnapshot: StructuredAgentRuntimeSnapshot = {
      ...snapshot,
      events: [
        ...snapshot.events,
        {
          connectionId: 'connection-1', providerId: 'codex', nativeSessionId: 'native-1',
          turnId: 'turn-1', eventId: 'event-4', parentEventId: null, sequence: 4,
          generation: 1, timestamp: '2026-08-27T00:00:04.000Z', kind: 'command.started',
          payload: {
            activityId: 'command-1',
            title: 'npm run verify',
            detail: 'D:\\workspace'
          }
        },
        {
          connectionId: 'connection-1', providerId: 'codex', nativeSessionId: 'native-1',
          turnId: 'turn-1', eventId: 'event-5', parentEventId: null, sequence: 5,
          generation: 1, timestamp: '2026-08-27T00:00:05.000Z', kind: 'command.updated',
          payload: {
            activityId: 'command-1',
            status: 'completed',
            detail: 'All tests passed.'
          }
        }
      ]
    };
    renderWithLocalization(
      <StructuredAgentWorkspace
        activeConnectionId="connection-1"
        api={{ dispatchStructuredAgentAction: vi.fn(async () => undefined) } as unknown as LumoraApi}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onReconnect={vi.fn()}
        snapshots={[commandSnapshot]}
      />
    );

    const process = screen.getByText('Process').closest('details');
    expect(process).toHaveClass('structured-process');
    expect(process).not.toHaveAttribute('open');
    expect(screen.getByText('The tests are fixed.').closest('.structured-process')).toBeNull();
    fireEvent.click(process!.querySelector(':scope > summary')!);
    expect(process).toHaveAttribute('open');

    const command = screen.getByText('npm run verify').closest('details');
    expect(command).toHaveClass('structured-activity-command');
    expect(command).not.toHaveAttribute('open');
    fireEvent.click(command!.querySelector('summary')!);
    expect(command).toHaveAttribute('open');
  });

  it('keeps unsent composer drafts isolated by provider connection', () => {
    const secondSnapshot: StructuredAgentRuntimeSnapshot = {
      ...snapshot,
      runtime: {
        ...snapshot.runtime,
        connectionId: 'connection-2',
        nativeSessionId: 'native-2',
        title: 'Second session'
      },
      events: []
    };
    const props = {
      api: {
        dispatchStructuredAgentAction: vi.fn(async () => undefined)
      } as unknown as LumoraApi,
      onActivate: vi.fn(),
      onClose: vi.fn(),
      onReconnect: vi.fn(),
      snapshots: [snapshot, secondSnapshot]
    };
    const view = renderWithLocalization(
      <StructuredAgentWorkspace {...props} activeConnectionId="connection-1" />
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Message Codex' }), {
      target: { value: 'Draft for the first session' }
    });

    view.rerender(
      <StructuredAgentWorkspace {...props} activeConnectionId="connection-2" />
    );
    expect(screen.getByRole('textbox', { name: 'Message Codex' }))
      .toHaveValue('');

    view.rerender(
      <StructuredAgentWorkspace {...props} activeConnectionId="connection-1" />
    );
    expect(screen.getByRole('textbox', { name: 'Message Codex' }))
      .toHaveValue('Draft for the first session');
  });

  it('replaces Send with one stop-turn action while a turn is running', () => {
    const runningSnapshot: StructuredAgentRuntimeSnapshot = {
      ...snapshot,
      events: [
        ...snapshot.events,
        {
          connectionId: 'connection-1', providerId: 'codex', nativeSessionId: 'native-1',
          turnId: 'turn-2', eventId: 'event-4', parentEventId: null, sequence: 4,
          generation: 1, timestamp: '2026-08-27T00:00:04.000Z', kind: 'turn.started',
          payload: { state: 'running', message: null }
        }
      ]
    };
    const dispatchStructuredAgentAction = vi.fn(async () => undefined);
    renderWithLocalization(
      <StructuredAgentWorkspace
        activeConnectionId="connection-1"
        api={{ dispatchStructuredAgentAction } as unknown as LumoraApi}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onReconnect={vi.fn()}
        snapshots={[runningSnapshot]}
      />
    );

    const composer = screen.getByRole('textbox', { name: 'Message Codex' });
    fireEvent.change(composer, { target: { value: 'Wait for the current turn' } });
    expect(composer).not.toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel turn' }));
    expect(dispatchStructuredAgentAction).toHaveBeenCalledWith({
      kind: 'turn.cancel',
      connectionId: 'connection-1'
    });
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(dispatchStructuredAgentAction).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'prompt.submit' })
    );
  });

  it('uses the latest turn state instead of a stale historical running turn', () => {
    const completedSnapshot: StructuredAgentRuntimeSnapshot = {
      ...snapshot,
      events: [
        ...snapshot.events,
        {
          connectionId: 'connection-1', providerId: 'codex', nativeSessionId: 'native-1',
          turnId: 'turn-stale', eventId: 'event-4', parentEventId: null, sequence: 4,
          generation: 1, timestamp: '2026-08-27T00:00:04.000Z', kind: 'turn.started',
          payload: { state: 'running', message: null }
        },
        {
          connectionId: 'connection-1', providerId: 'codex', nativeSessionId: 'native-1',
          turnId: 'turn-current', eventId: 'event-5', parentEventId: null, sequence: 5,
          generation: 1, timestamp: '2026-08-27T00:00:05.000Z', kind: 'turn.started',
          payload: { state: 'running', message: null }
        },
        {
          connectionId: 'connection-1', providerId: 'codex', nativeSessionId: 'native-1',
          turnId: 'turn-current', eventId: 'event-6', parentEventId: null, sequence: 6,
          generation: 1, timestamp: '2026-08-27T00:00:06.000Z', kind: 'turn.completed',
          payload: { state: 'completed', message: null }
        }
      ]
    };
    renderWithLocalization(
      <StructuredAgentWorkspace
        activeConnectionId="connection-1"
        api={{ dispatchStructuredAgentAction: vi.fn(async () => undefined) } as unknown as LumoraApi}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onReconnect={vi.fn()}
        snapshots={[completedSnapshot]}
      />
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Message Codex' }), {
      target: { value: 'Continue with the next task' }
    });

    expect(screen.queryByRole('button', { name: 'Cancel turn' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('focuses its composer when Lumora requests terminal input focus', () => {
    const props = {
      api: {
        dispatchStructuredAgentAction: vi.fn(async () => undefined)
      } as unknown as LumoraApi,
      activeConnectionId: 'connection-1',
      onActivate: vi.fn(),
      onClose: vi.fn(),
      onReconnect: vi.fn(),
      snapshots: [snapshot]
    };
    const view = renderWithLocalization(
      <StructuredAgentWorkspace {...props} focusRequestKey={0} />
    );
    const composer = screen.getByRole('textbox', { name: 'Message Codex' });
    composer.blur();

    view.rerender(
      <StructuredAgentWorkspace {...props} focusRequestKey={1} />
    );

    expect(composer).toHaveFocus();
  });
});
