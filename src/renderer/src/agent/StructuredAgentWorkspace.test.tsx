import { fireEvent, screen, waitFor } from '@testing-library/react';
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
  commands: [
    {
      id: 'compact',
      name: '/compact',
      description: 'Compact the current context.',
      inputHint: null
    },
    {
      id: 'review',
      name: '/review',
      description: 'Review the current workspace.',
      inputHint: '[instructions]'
    }
  ],
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

  it('keeps session and subscription usage in a details dialog', async () => {
    const usageSnapshot: StructuredAgentRuntimeSnapshot = {
      ...snapshot,
      events: [
        ...snapshot.events,
        {
          connectionId: 'connection-1', providerId: 'codex', nativeSessionId: 'native-1',
          turnId: 'turn-1', eventId: 'event-usage', parentEventId: null, sequence: 4,
          generation: 1, timestamp: '2026-08-27T00:00:04.000Z', kind: 'usage.updated',
          payload: {
            inputTokens: 10,
            cachedInputTokens: 2,
            outputTokens: 4,
            totalTokens: 14
          }
        },
        {
          connectionId: 'connection-1', providerId: 'codex', nativeSessionId: 'native-1',
          turnId: 'turn-1', eventId: 'event-account-usage', parentEventId: null, sequence: 5,
          generation: 1, timestamp: '2026-08-27T00:00:05.000Z', kind: 'account.usage.updated',
          payload: {
            plan: 'pro',
            windows: [{
              kind: 'primary',
              usedPercent: 25,
              windowDurationMinutes: 300,
              resetsAt: 1_788_000_000
            }]
          }
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
        snapshots={[usageSnapshot]}
      />
    );

    expect(screen.queryByText('14 tokens used')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Session details' }));

    const dialog = screen.getByRole('dialog', { name: 'Session details' });
    expect(dialog).toHaveTextContent('Repository cleanup');
    expect(dialog).toHaveTextContent('Codex');
    expect(dialog).toHaveTextContent('14');
    expect(dialog).toHaveTextContent('10');
    expect(dialog).toHaveTextContent('2');
    expect(dialog).toHaveTextContent('4');
    expect(await screen.findByText('75% left')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('pro');
    expect(dispatchStructuredAgentAction).toHaveBeenCalledWith({
      kind: 'session.details.refresh',
      connectionId: 'connection-1'
    });
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

  it('retains completed turns when the bounded event tail advances', () => {
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

    expect(screen.getByText('The tests are fixed.')).toBeInTheDocument();

    const advancedTail: StructuredAgentRuntimeSnapshot = {
      ...snapshot,
      events: [
        {
          connectionId: 'connection-1', providerId: 'codex', nativeSessionId: 'native-1',
          turnId: 'turn-2', eventId: 'event-500', parentEventId: null, sequence: 500,
          generation: 1, timestamp: '2026-08-27T00:08:20.000Z', kind: 'user.message',
          payload: { text: 'Continue with the next task.' }
        },
        {
          connectionId: 'connection-1', providerId: 'codex', nativeSessionId: 'native-1',
          turnId: 'turn-2', eventId: 'event-501', parentEventId: null, sequence: 501,
          generation: 1, timestamp: '2026-08-27T00:08:21.000Z', kind: 'assistant.message',
          payload: { text: 'The next task is complete.' }
        },
        {
          connectionId: 'connection-1', providerId: 'codex', nativeSessionId: 'native-1',
          turnId: 'turn-2', eventId: 'event-502', parentEventId: null, sequence: 502,
          generation: 1, timestamp: '2026-08-27T00:08:22.000Z', kind: 'turn.completed',
          payload: { state: 'completed', message: null }
        }
      ]
    };
    view.rerender(
      <StructuredAgentWorkspace {...props} snapshots={[advancedTail]} />
    );

    expect(screen.getByText('The tests are fixed.')).toBeInTheDocument();
    expect(screen.getByText('The next task is complete.')).toBeInTheDocument();
  });

  it('reveals earlier turns at the top edge and preserves the visible scroll anchor', () => {
    const events: StructuredAgentRuntimeSnapshot['events'] = [];
    for (let index = 1; index <= 30; index += 1) {
      events.push({
        connectionId: 'connection-1', providerId: 'codex', nativeSessionId: 'native-1',
        turnId: `turn-${index}`, eventId: `user-${index}`, parentEventId: null,
        sequence: index * 2, generation: 1,
        timestamp: `2026-08-27T00:${String(index).padStart(2, '0')}:00.000Z`,
        kind: 'user.message', payload: { text: `Turn ${index} request` }
      });
      events.push({
        connectionId: 'connection-1', providerId: 'codex', nativeSessionId: 'native-1',
        turnId: `turn-${index}`, eventId: `assistant-${index}`, parentEventId: null,
        sequence: index * 2 + 1, generation: 1,
        timestamp: `2026-08-27T00:${String(index).padStart(2, '0')}:01.000Z`,
        kind: 'assistant.message', payload: { text: `Turn ${index} reply` }
      });
    }
    renderWithLocalization(
      <StructuredAgentWorkspace
        activeConnectionId="connection-1"
        api={{ dispatchStructuredAgentAction: vi.fn(async () => undefined) } as unknown as LumoraApi}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onReconnect={vi.fn()}
        snapshots={[{ ...snapshot, boundary: null, events }]}
      />
    );

    expect(screen.queryByText('Turn 25 reply')).not.toBeInTheDocument();
    expect(screen.getByText('Turn 26 reply')).toBeInTheDocument();
    expect(screen.getByText('Turn 30 reply')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load earlier messages' })).not.toBeInTheDocument();

    const body = document.querySelector('.structured-agent-body') as HTMLDivElement;
    Object.defineProperty(body, 'clientHeight', { configurable: true, value: 300 });
    Object.defineProperty(body, 'scrollHeight', {
      configurable: true,
      get: () => screen.queryByText('Turn 21 reply') === null ? 600 : 900
    });
    body.scrollTop = 0;
    fireEvent.scroll(body);

    expect(screen.queryByText('Turn 20 reply')).not.toBeInTheDocument();
    expect(screen.getByText('Turn 21 reply')).toBeInTheDocument();
    expect(body.scrollTop).toBe(300);
  });

  it('loads fewer than five recent turns when rich content reaches the render budget', () => {
    const events: StructuredAgentRuntimeSnapshot['events'] = [];
    for (let index = 1; index <= 5; index += 1) {
      events.push({
        connectionId: 'connection-1', providerId: 'codex', nativeSessionId: 'native-1',
        turnId: `heavy-turn-${index}`, eventId: `heavy-user-${index}`, parentEventId: null,
        sequence: index * 2, generation: 1,
        timestamp: `2026-08-27T01:0${index}:00.000Z`,
        kind: 'user.message', payload: { text: `Heavy turn ${index} request` }
      });
      events.push({
        connectionId: 'connection-1', providerId: 'codex', nativeSessionId: 'native-1',
        turnId: `heavy-turn-${index}`, eventId: `heavy-assistant-${index}`, parentEventId: null,
        sequence: index * 2 + 1, generation: 1,
        timestamp: `2026-08-27T01:0${index}:01.000Z`,
        kind: 'assistant.message', payload: {
          text: `Heavy turn ${index} reply ${'x'.repeat(20_000)}`
        }
      });
    }

    renderWithLocalization(
      <StructuredAgentWorkspace
        activeConnectionId="connection-1"
        api={{ dispatchStructuredAgentAction: vi.fn(async () => undefined) } as unknown as LumoraApi}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onReconnect={vi.fn()}
        snapshots={[{ ...snapshot, boundary: null, events }]}
      />
    );

    expect(screen.queryByText('Heavy turn 4 request')).not.toBeInTheDocument();
    expect(screen.getByText('Heavy turn 5 request')).toBeInTheDocument();
  });

  it('shows the active turn state beside the provider title in the assistant message', () => {
    const runningSnapshot: StructuredAgentRuntimeSnapshot = {
      ...snapshot,
      events: [
        ...snapshot.events,
        {
          connectionId: 'connection-1', providerId: 'codex', nativeSessionId: 'native-1',
          turnId: 'turn-2', eventId: 'event-running', parentEventId: null, sequence: 4,
          generation: 1, timestamp: '2026-08-27T00:00:04.000Z', kind: 'turn.started',
          payload: { state: 'running', message: null }
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
        snapshots={[runningSnapshot]}
      />
    );

    const status = screen.getByText('Running');
    expect(status.closest('.structured-assistant-title'))
      .toHaveTextContent('CodexRunning');
    expect(screen.getByRole('heading', { name: 'Repository cleanup' }).parentElement)
      .not.toHaveTextContent('Running');
  });

  it('renders assistant Markdown safely and opens validated links through Lumora', async () => {
    await import('./AgentMarkdown');
    const openTerminalLink = vi.fn(async () => undefined);
    const markdownSnapshot: StructuredAgentRuntimeSnapshot = {
      ...snapshot,
      events: [
        snapshot.events[0]!,
        {
          connectionId: 'connection-1', providerId: 'codex', nativeSessionId: 'native-1',
          turnId: 'turn-1', eventId: 'event-markdown', parentEventId: null, sequence: 2,
          generation: 1, timestamp: '2026-08-27T00:00:02.000Z', kind: 'assistant.message',
          payload: {
            text: '**Completed**\n\n- First change\n- Second change\n\n`npm test`\n\n[Review the docs](https://example.com/docs)\n\n[Unsafe link](javascript:alert(1))\n\n<script>alert(1)</script>'
          }
        }
      ]
    };
    renderWithLocalization(
      <StructuredAgentWorkspace
        activeConnectionId="connection-1"
        api={{
          dispatchStructuredAgentAction: vi.fn(async () => undefined),
          openTerminalLink
        } as unknown as LumoraApi}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onReconnect={vi.fn()}
        snapshots={[markdownSnapshot]}
      />
    );

    expect((await screen.findByText('Completed')).tagName).toBe('STRONG');
    expect(await screen.findAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('npm test').tagName).toBe('CODE');
    expect(screen.queryByText('alert(1)')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Unsafe link' })).not.toBeInTheDocument();
    expect(screen.getByText('Unsafe link').tagName).toBe('SPAN');

    fireEvent.click(screen.getByRole('link', { name: 'Review the docs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open link' }));
    expect(openTerminalLink).toHaveBeenCalledWith('https://example.com/docs');
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

  it('returns focus to the composer after submitting a prompt', async () => {
    let finishSubmit!: () => void;
    const dispatchStructuredAgentAction = vi.fn(() => new Promise<void>((resolve) => {
      finishSubmit = resolve;
    }));
    renderWithLocalization(
      <>
        <button type="button">Other control</button>
        <StructuredAgentWorkspace
          activeConnectionId="connection-1"
          api={{ dispatchStructuredAgentAction } as unknown as LumoraApi}
          onActivate={vi.fn()}
          onClose={vi.fn()}
          onReconnect={vi.fn()}
          snapshots={[snapshot]}
        />
      </>
    );
    const composer = screen.getByRole('textbox', { name: 'Message Codex' });
    composer.focus();
    fireEvent.change(composer, { target: { value: 'Keep typing here' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    screen.getByRole('button', { name: 'Other control' }).focus();
    finishSubmit();

    await waitFor(() => expect(composer).toHaveFocus());
  });

  it('opens, filters, and executes the provider command list from the composer', () => {
    const { dispatchStructuredAgentAction } = renderWorkspace();
    const composer = screen.getByRole('textbox', { name: 'Message Codex' });

    fireEvent.change(composer, { target: { value: '/' } });
    expect(screen.getByRole('listbox', { name: 'Command' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /compact/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /review/i })).toBeInTheDocument();

    fireEvent.change(composer, { target: { value: '/com' } });
    expect(screen.getByRole('option', { name: /compact/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /review/i })).not.toBeInTheDocument();
    fireEvent.keyDown(composer, { key: 'Enter' });

    expect(dispatchStructuredAgentAction).toHaveBeenCalledWith({
      kind: 'command.execute',
      connectionId: 'connection-1',
      commandId: 'compact',
      argument: ''
    });
  });

  it('copies the latest assistant response through Lumora without dispatching a provider command', async () => {
    const writeClipboardText = vi.fn(async () => undefined);
    const dispatchStructuredAgentAction = vi.fn(async () => undefined);
    const copySnapshot: StructuredAgentRuntimeSnapshot = {
      ...snapshot,
      commands: [
        ...(snapshot.commands ?? []),
        {
          id: 'copy',
          name: '/copy',
          description: 'Copy the latest assistant response.',
          inputHint: null
        }
      ]
    };
    renderWithLocalization(
      <StructuredAgentWorkspace
        activeConnectionId="connection-1"
        api={{
          dispatchStructuredAgentAction,
          writeClipboardText
        } as unknown as LumoraApi}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onReconnect={vi.fn()}
        snapshots={[copySnapshot]}
      />
    );
    const composer = screen.getByRole('textbox', { name: 'Message Codex' });

    fireEvent.change(composer, { target: { value: '/copy' } });
    fireEvent.keyDown(composer, { key: 'Enter' });

    await vi.waitFor(() => {
      expect(writeClipboardText).toHaveBeenCalledWith('The tests are fixed.');
    });
    expect(dispatchStructuredAgentAction).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'command.execute', commandId: 'copy' })
    );
  });

  it('completes commands that need arguments without sending an empty command', () => {
    const { dispatchStructuredAgentAction } = renderWorkspace();
    const composer = screen.getByRole('textbox', { name: 'Message Codex' });

    fireEvent.change(composer, { target: { value: '/rev' } });
    fireEvent.keyDown(composer, { key: 'Enter' });

    expect(composer).toHaveValue('/review ');
    expect(dispatchStructuredAgentAction).not.toHaveBeenCalled();
  });

  it('opens dynamic command choices and either executes or continues composition', () => {
    const choiceSnapshot: StructuredAgentRuntimeSnapshot = {
      ...snapshot,
      commands: [
        ...(snapshot.commands ?? []),
        {
          id: 'model',
          name: '/model',
          description: 'Choose the model for future turns.',
          inputHint: '<model>',
          choices: [
            {
              value: 'gpt-5.6-sol',
              label: 'GPT-5.6 Sol',
              description: 'Frontier coding model'
            }
          ],
          selectionBehavior: 'execute'
        },
        {
          id: 'skill',
          name: '/skill',
          description: 'Run a skill for the next task.',
          inputHint: '<skill> [task]',
          choices: [{
            value: 'test-driven-development',
            label: 'test-driven-development',
            description: 'Use red-green-refactor.'
          }],
          selectionBehavior: 'continue'
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
        snapshots={[choiceSnapshot]}
      />
    );
    const composer = screen.getByRole('textbox', { name: 'Message Codex' });

    fireEvent.change(composer, { target: { value: '/model' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(composer).toHaveValue('/model ');
    expect(screen.getByRole('option', { name: /GPT-5.6 Sol/ })).toBeInTheDocument();
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(dispatchStructuredAgentAction).toHaveBeenCalledWith({
      kind: 'command.execute',
      connectionId: 'connection-1',
      commandId: 'model',
      argument: 'gpt-5.6-sol'
    });

    fireEvent.change(composer, { target: { value: '/skill' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(composer).toHaveValue('/skill test-driven-development ');
  });

  it('keeps the prompt composer independent from conversation message length', () => {
    renderWorkspace();
    const composer = screen.getByRole('textbox', { name: 'Message Codex' });
    const send = screen.getByRole('button', { name: 'Send' });
    expect(composer).toHaveAttribute('rows', '3');
    expect(composer).not.toHaveAttribute('style');
    expect(composer.closest('.structured-composer-surface')).toContainElement(send);
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

  it('renders an expandable, display-only unified diff box for changed files', () => {
    const diffSnapshot: StructuredAgentRuntimeSnapshot = {
      ...snapshot,
      events: [
        ...snapshot.events,
        {
          connectionId: 'connection-1', providerId: 'codex', nativeSessionId: 'native-1',
          turnId: 'turn-1', eventId: 'event-diff', parentEventId: null, sequence: 4,
          generation: 1, timestamp: '2026-08-27T00:00:04.000Z', kind: 'diff.updated',
          payload: {
            diffId: 'turn-1:workspace',
            files: [{
              pathLabel: 'src/app.ts', oldPathLabel: null,
              additions: 1, deletions: 1,
              patch: '@@ -1 +1 @@\n-export const ready = false;\n+export const ready = true;'
            }]
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
        snapshots={[diffSnapshot]}
      />
    );

    const process = screen.getByText('Process').closest('details')!;
    fireEvent.click(process.querySelector(':scope > summary')!);
    const diff = screen.getByText('src/app.ts').closest('details')!;
    expect(diff).toHaveClass('structured-diff');
    expect(diff).not.toHaveAttribute('open');
    expect(diff).toHaveTextContent('+1');
    expect(diff).toHaveTextContent('-1');
    fireEvent.click(diff.querySelector(':scope > summary')!);
    expect(diff).toHaveAttribute('open');
    expect(screen.getByText('+export const ready = true;')).toHaveClass('structured-diff-addition');
    expect(screen.getByText('-export const ready = false;')).toHaveClass('structured-diff-deletion');
    expect(screen.queryByRole('button', { name: /accept|reject|revert/i })).not.toBeInTheDocument();
  });

  it('shows the process entry when a provider only reports operation completion', () => {
    const completionOnlySnapshot: StructuredAgentRuntimeSnapshot = {
      ...snapshot,
      events: [
        ...snapshot.events,
        {
          connectionId: 'connection-1', providerId: 'codex', nativeSessionId: 'native-1',
          turnId: 'turn-1', eventId: 'event-4', parentEventId: null, sequence: 4,
          generation: 1, timestamp: '2026-08-27T00:00:04.000Z', kind: 'tool.updated',
          payload: {
            activityId: 'tool-completed', title: 'browser · open',
            status: 'completed', detail: null
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
        snapshots={[completionOnlySnapshot]}
      />
    );

    expect(screen.getByText('Process').closest('details')).toHaveClass('structured-process');
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
    const cancel = screen.getByRole('button', { name: 'Cancel turn' });
    expect(composer.closest('.structured-composer-surface')).toContainElement(cancel);
    fireEvent.click(cancel);
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

  it('selects a model inside the composer without clearing the draft and keeps slash commands usable', async () => {
    const modelSnapshot: StructuredAgentRuntimeSnapshot = {
      ...snapshot,
      commands: [{
        id: 'model',
        name: '/model',
        description: 'Choose the model for future turns.',
        inputHint: '<model>',
        choices: [
          { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', description: null },
          { value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', description: null }
        ],
        selectedValue: 'gpt-5.6-sol',
        selectionBehavior: 'execute'
      }]
    };
    const dispatchStructuredAgentAction = vi.fn(async () => undefined);
    renderWithLocalization(
      <StructuredAgentWorkspace
        activeConnectionId="connection-1"
        api={{ dispatchStructuredAgentAction } as unknown as LumoraApi}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onReconnect={vi.fn()}
        snapshots={[modelSnapshot]}
      />
    );

    const composer = screen.getByRole('textbox', { name: 'Message Codex' });
    const modelSelector = screen.getByRole('button', { name: 'Model' });
    const send = screen.getByRole('button', { name: 'Send' });
    const actions = send.closest<HTMLElement>('.structured-composer-actions');
    expect(actions).not.toBeNull();
    expect(actions).toContainElement(modelSelector);
    expect(composer.closest<HTMLElement>('.structured-composer-surface')).toContainElement(actions);
    fireEvent.change(composer, { target: { value: 'Keep this drafted prompt' } });
    fireEvent.click(modelSelector);
    fireEvent.click(screen.getByRole('option', { name: 'GPT-5.6 Terra' }));

    await vi.waitFor(() => expect(dispatchStructuredAgentAction).toHaveBeenCalledWith({
      kind: 'command.execute',
      connectionId: 'connection-1',
      commandId: 'model',
      argument: 'gpt-5.6-terra'
    }));
    expect(composer).toHaveValue('Keep this drafted prompt');

    fireEvent.change(composer, { target: { value: '/model ' } });
    expect(screen.getByRole('option', { name: 'GPT-5.6 Sol' })).toBeInTheDocument();
  });
});
