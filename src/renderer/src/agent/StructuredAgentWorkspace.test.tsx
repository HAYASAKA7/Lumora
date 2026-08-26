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
  const api = { dispatchStructuredAgentAction } as unknown as LumoraApi;
  renderWithLocalization(
    <StructuredAgentWorkspace
      activeConnectionId="connection-1"
      api={api}
      onActivate={vi.fn()}
      onClose={vi.fn()}
      onReconnect={vi.fn()}
      snapshots={[snapshot]}
    />
  );
  return { dispatchStructuredAgentAction };
}

describe('StructuredAgentWorkspace', () => {
  it('renders provider-owned conversation history and dispatches approval actions', () => {
    const { dispatchStructuredAgentAction } = renderWorkspace();

    expect(screen.getByText('Fix the tests.')).toBeInTheDocument();
    expect(screen.getByText('The tests are fixed.')).toBeInTheDocument();
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

  it('keeps a draft editable but prevents a second prompt while a turn is running', () => {
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
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(dispatchStructuredAgentAction).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'prompt.submit' })
    );
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
