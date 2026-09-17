import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  LumoraApi,
  StructuredAgentRuntimeSnapshot
} from '../../../shared/contracts';
import { fakeChangesApi } from '../test/changes-test-support';
import { renderWithLocalization } from '../test/render-with-localization';
import { StructuredAgentWorkspace } from './StructuredAgentWorkspace';

// jsdom cannot decode or draw an image; stand in for the canvas step, and
// treat an empty file as one that does not decode.
vi.mock('./structured-image-attachments', async (importOriginal) => ({
  ...await importOriginal<typeof import('./structured-image-attachments')>(),
  prepareImage: vi.fn(async (file: Blob) => {
    if (file.size === 0) throw new Error('not an image');
    return {
      mimeType: 'image/png',
      data: new Uint8Array([1, 2, 3]),
      previewUrl: 'data:image/png;base64,AQID'
    };
  })
}));

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

function imageFile(name = 'screenshot.png', type = 'image/png', bytes = [1]): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function renderImageWorkspace(events: StructuredAgentRuntimeSnapshot['events'] = []) {
  const dispatchStructuredAgentAction = vi.fn(async () => undefined);
  let staged = 0;
  const stageStructuredImage = vi.fn(async () => {
    staged += 1;
    return { token: `image-${staged}`, width: 10, height: 8, bytes: 3 };
  });
  const api = { dispatchStructuredAgentAction, stageStructuredImage } as unknown as LumoraApi;
  renderWithLocalization(
    <StructuredAgentWorkspace
      activeConnectionId="connection-1"
      api={api}
      onActivate={vi.fn()}
      onClose={vi.fn()}
      onReconnect={vi.fn()}
      snapshots={[{
        ...snapshot,
        runtime: { ...snapshot.runtime, acceptsImages: true },
        events
      }]}
    />
  );
  const composer = screen.getByRole('textbox');
  const paste = (files: File[], text = '') => fireEvent.paste(composer, {
    clipboardData: { files, getData: () => text }
  });
  return { composer, dispatchStructuredAgentAction, paste, stageStructuredImage };
}

function renderFileWorkspace(options: {
  acceptsImages?: boolean;
  files?: Array<{ name: string; path: string }>;
  droppedPath?: string | null;
} = {}) {
  const dispatchStructuredAgentAction = vi.fn(async () => undefined);
  const chooseStructuredFiles = vi.fn(async () => ({ files: options.files ?? [] }));
  const droppedFilePath = vi.fn(() => options.droppedPath ?? null);
  let staged = 0;
  const stageStructuredImage = vi.fn(async () => {
    staged += 1;
    return { token: `image-${staged}`, width: 10, height: 8, bytes: 3 };
  });
  const api = {
    dispatchStructuredAgentAction,
    chooseStructuredFiles,
    droppedFilePath,
    stageStructuredImage
  } as unknown as LumoraApi;
  renderWithLocalization(
    <StructuredAgentWorkspace
      activeConnectionId="connection-1"
      api={api}
      onActivate={vi.fn()}
      onClose={vi.fn()}
      onReconnect={vi.fn()}
      snapshots={[{
        ...snapshot,
        runtime: {
          ...snapshot.runtime,
          ...(options.acceptsImages === true ? { acceptsImages: true } : {})
        },
        events: []
      }]}
    />
  );
  return {
    composer: screen.getByRole('textbox'),
    chooseStructuredFiles,
    dispatchStructuredAgentAction,
    droppedFilePath,
    stageStructuredImage
  };
}

function turnEvent(
  sequence: number,
  turnId: string,
  kind: 'turn.started' | 'turn.completed',
  state: 'running' | 'completed'
): StructuredAgentRuntimeSnapshot['events'][number] {
  return {
    connectionId: 'connection-1', providerId: 'codex', nativeSessionId: 'native-1',
    turnId, eventId: `event-${sequence}`, parentEventId: null, sequence,
    generation: 1, timestamp: `2026-08-27T00:00:${String(sequence).padStart(2, '0')}.000Z`,
    kind, payload: { state, message: null }
  };
}

function workingSnapshot(
  canSteer: boolean,
  extra: StructuredAgentRuntimeSnapshot['events'] = []
): StructuredAgentRuntimeSnapshot {
  return {
    ...snapshot,
    runtime: { ...snapshot.runtime, canSteer },
    events: [...snapshot.events, turnEvent(4, 'turn-2', 'turn.started', 'running'), ...extra]
  };
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

  it('offers the approval choices as standard Lumora buttons', () => {
    renderWorkspace();

    expect(screen.getByRole('button', { name: 'Allow once' }))
      .toHaveClass('refresh-button');
    expect(screen.getByRole('button', { name: 'Deny' }))
      .toHaveClass('secondary-button');
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

  it('keeps revealed history while the agent goes on answering', () => {
    const turnEvents = (count: number): StructuredAgentRuntimeSnapshot['events'] => {
      const events: StructuredAgentRuntimeSnapshot['events'] = [];
      for (let index = 1; index <= count; index += 1) {
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
      return events;
    };
    const workspace = (events: StructuredAgentRuntimeSnapshot['events']) => (
      <StructuredAgentWorkspace
        activeConnectionId="connection-1"
        api={{ dispatchStructuredAgentAction: vi.fn(async () => undefined) } as unknown as LumoraApi}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onReconnect={vi.fn()}
        snapshots={[{ ...snapshot, boundary: null, events }]}
      />
    );
    const view = renderWithLocalization(workspace(turnEvents(30)));

    const body = document.querySelector('.structured-agent-body') as HTMLDivElement;
    Object.defineProperty(body, 'clientHeight', { configurable: true, value: 300 });
    Object.defineProperty(body, 'scrollHeight', { configurable: true, get: () => 900 });
    body.scrollTop = 0;
    fireEvent.scroll(body);
    expect(screen.getByText('Turn 21 reply')).toBeInTheDocument();

    // The agent answers again while the earlier turns are being read.
    view.rerender(workspace(turnEvents(31)));

    expect(screen.getByText('Turn 31 reply')).toBeInTheDocument();
    expect(screen.getByText('Turn 21 reply')).toBeInTheDocument();
  });

  it('lets revealed history go once the reader is back at the latest message', () => {
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

    const body = document.querySelector('.structured-agent-body') as HTMLDivElement;
    Object.defineProperty(body, 'clientHeight', { configurable: true, value: 300 });
    Object.defineProperty(body, 'scrollHeight', { configurable: true, get: () => 900 });
    body.scrollTop = 0;
    fireEvent.scroll(body);
    expect(screen.getByText('Turn 21 reply')).toBeInTheDocument();

    body.scrollTop = 600;
    fireEvent.scroll(body);

    expect(screen.queryByText('Turn 21 reply')).not.toBeInTheDocument();
    expect(screen.getByText('Turn 30 reply')).toBeInTheDocument();
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
  }, 15_000);

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

  it('keeps Stop while a turn runs and holds a message for an agent that takes one at a time', () => {
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
    // The message waits for the turn instead of being lost or sent into it.
    expect(screen.getByRole('list', { name: 'Messages waiting for Codex' })).toHaveTextContent('Wait for the current turn');
    expect(composer).toHaveValue('');
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

  it('changes the mode and the model while the agent is working', async () => {
    const workingWithPickers: StructuredAgentRuntimeSnapshot = {
      ...workingSnapshot(true),
      commands: [
        {
          id: 'mode',
          name: '/mode',
          description: 'Choose how Codex works.',
          inputHint: null,
          choices: [
            { value: 'default', label: 'Default', description: null },
            { value: 'plan', label: 'Plan', description: null }
          ],
          selectedValue: 'default',
          selectionBehavior: 'execute'
        },
        {
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
        snapshots={[workingWithPickers]}
      />
    );

    expect(screen.getByRole('button', { name: 'Cancel turn' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Model' }));
    fireEvent.click(screen.getByRole('option', { name: 'GPT-5.6 Terra' }));
    await vi.waitFor(() => expect(dispatchStructuredAgentAction).toHaveBeenCalledWith({
      kind: 'command.execute',
      connectionId: 'connection-1',
      commandId: 'model',
      argument: 'gpt-5.6-terra'
    }));

    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Mode' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Mode' }));
    fireEvent.click(screen.getByRole('option', { name: 'Plan' }));
    await vi.waitFor(() => expect(dispatchStructuredAgentAction).toHaveBeenCalledWith({
      kind: 'command.execute',
      connectionId: 'connection-1',
      commandId: 'mode',
      argument: 'plan'
    }));

    // Changing a setting is not sending a message: the turn is still the one running.
    expect(screen.getByRole('button', { name: 'Cancel turn' })).toBeInTheDocument();
    expect(dispatchStructuredAgentAction).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'prompt.submit' })
    );
  });

  it('offers images only to a session that accepts them', () => {
    renderWorkspace();

    expect(screen.queryByRole('button', { name: 'Attach' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Attach files' })).toBeTruthy();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('stages a pasted image and sends it on its own, without text', async () => {
    const { dispatchStructuredAgentAction, paste, stageStructuredImage } = renderImageWorkspace();
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);

    paste([imageFile()]);

    expect(await screen.findByRole('img', { name: 'Attached image 1' })).toBeTruthy();
    expect(stageStructuredImage).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: 'connection-1',
      mimeType: 'image/png'
    }));
    await waitFor(() => expect(send.disabled).toBe(false));
    fireEvent.click(send);

    expect(dispatchStructuredAgentAction).toHaveBeenCalledWith({
      kind: 'prompt.submit',
      connectionId: 'connection-1',
      text: '',
      attachmentTokens: ['image-1']
    });
    await waitFor(() => expect(screen.queryByRole('img', { name: 'Attached image 1' })).toBeNull());
  });

  it('sends the text and the images of one message together', async () => {
    const { composer, dispatchStructuredAgentAction, paste } = renderImageWorkspace();

    paste([imageFile('a.png'), imageFile('b.jpg', 'image/jpeg')]);
    fireEvent.change(composer, { target: { value: 'What changed between these?' } });
    await screen.findByRole('img', { name: 'Attached image 2' });
    await waitFor(() => expect(
      (screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled
    ).toBe(false));
    fireEvent.keyDown(composer, { key: 'Enter' });

    expect(dispatchStructuredAgentAction).toHaveBeenCalledWith({
      kind: 'prompt.submit',
      connectionId: 'connection-1',
      text: 'What changed between these?',
      attachmentTokens: ['image-1', 'image-2']
    });
  });

  it('leaves a pasted picture with words as text as well', async () => {
    const { composer, paste } = renderImageWorkspace();

    const event = paste([imageFile()], 'Copied words');

    // fireEvent returns false only when the default was prevented.
    expect(event).toBe(true);
    expect(await screen.findByRole('img', { name: 'Attached image 1' })).toBeTruthy();
    expect(composer).toBeTruthy();
  });

  it('removes an image before it is sent', async () => {
    const { paste } = renderImageWorkspace();

    paste([imageFile()]);
    await screen.findByRole('img', { name: 'Attached image 1' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove image 1' }));

    expect(screen.queryByRole('img', { name: 'Attached image 1' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says why an image could not be attached, and stages nothing for it', async () => {
    const { paste, stageStructuredImage } = renderImageWorkspace();

    paste([imageFile('drawing.svg', 'image/svg+xml')]);
    expect(await screen.findByText(
      'Lumora could not attach that image. Use a PNG, JPEG, GIF or WebP image.'
    )).toBeTruthy();

    paste([imageFile('broken.png', 'image/png', [])]);
    await waitFor(() => expect(screen.queryByRole('listitem')).toBeNull());
    expect(screen.getByRole('alert').textContent).toContain('could not attach');
    expect(stageStructuredImage).not.toHaveBeenCalled();
  });

  it('holds a message to eight images', async () => {
    const { paste, stageStructuredImage } = renderImageWorkspace();

    paste(Array.from({ length: 9 }, (_, index) => imageFile(`shot-${index}.png`)));

    expect(await screen.findByText('A message can carry up to 8 images.')).toBeTruthy();
    await waitFor(() => expect(stageStructuredImage).toHaveBeenCalledTimes(8));
    expect(screen.getAllByRole('listitem')).toHaveLength(8);
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));
    expect(
      (screen.getByRole('menuitem', { name: 'Attach images' }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('attaches images dropped on the composer or picked from the file dialog', async () => {
    const { composer, stageStructuredImage } = renderImageWorkspace();
    const surface = composer.closest('.structured-composer-surface')!;

    fireEvent.dragOver(surface, { dataTransfer: { types: ['Files'], files: [] } });
    expect(surface.classList.contains('is-receiving-drop')).toBe(true);
    fireEvent.drop(surface, { dataTransfer: { types: ['Files'], files: [imageFile()] } });
    expect(surface.classList.contains('is-receiving-drop')).toBe(false);
    await screen.findByRole('img', { name: 'Attached image 1' });

    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [imageFile('picked.png')] }
    });
    await screen.findByRole('img', { name: 'Attached image 2' });
    await waitFor(() => expect(stageStructuredImage).toHaveBeenCalledTimes(2));
  });

  it('shows how many images a sent message carried', () => {
    renderImageWorkspace([{
      connectionId: 'connection-1', providerId: 'codex', nativeSessionId: 'native-1',
      turnId: 'turn-1', eventId: 'event-1', parentEventId: null, sequence: 1,
      generation: 1, timestamp: '2026-08-27T00:00:01.000Z', kind: 'user.message',
      payload: { text: '', imageCount: 2 }
    }]);

    expect(screen.getByText('2 images')).toBeTruthy();
  });

  it('offers files to every session, and images only where they are read', () => {
    renderFileWorkspace();

    expect(screen.getByRole('button', { name: 'Attach files' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Attach images' })).toBeNull();
  });

  it('sends chosen files as paths for the agent to open itself', async () => {
    const { composer, dispatchStructuredAgentAction } = renderFileWorkspace({
      files: [
        { name: 'notes.md', path: '/work/notes.md' },
        { name: 'run.log', path: '/work/run.log' }
      ]
    });

    fireEvent.click(screen.getByRole('button', { name: 'Attach files' }));
    expect(await screen.findByText('notes.md')).toBeTruthy();
    fireEvent.change(composer, { target: { value: 'Compare these' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(dispatchStructuredAgentAction).toHaveBeenCalledWith({
      kind: 'prompt.submit',
      connectionId: 'connection-1',
      text: [
        'Compare these',
        '',
        'Attached files:',
        '/work/notes.md',
        '/work/run.log'
      ].join(String.fromCharCode(10)),
      attachmentTokens: []
    });
    await waitFor(() => expect(screen.queryByText('notes.md')).toBeNull());
  });

  it('sends a file on its own, and drops one it cannot place on disk', async () => {
    const { dispatchStructuredAgentAction } = renderFileWorkspace({
      files: [{ name: 'report.pdf', path: '/work/report.pdf' }]
    });
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Attach files' }));
    await screen.findByText('report.pdf');
    await waitFor(() => expect(send.disabled).toBe(false));
    fireEvent.click(send);

    expect(dispatchStructuredAgentAction).toHaveBeenCalledWith(expect.objectContaining({
      text: ['Attached files:', '/work/report.pdf'].join(String.fromCharCode(10))
    }));
  });

  it('takes a dropped picture as an image and a dropped file as a path', async () => {
    const { composer, droppedFilePath, stageStructuredImage } = renderFileWorkspace({
      acceptsImages: true,
      droppedPath: '/work/plan.txt'
    });
    const surface = composer.closest('.structured-composer-surface')!;

    fireEvent.drop(surface, {
      dataTransfer: {
        types: ['Files'],
        files: [imageFile('shot.png'), imageFile('plan.txt', 'text/plain')]
      }
    });

    expect(await screen.findByText('plan.txt')).toBeTruthy();
    expect(droppedFilePath).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(stageStructuredImage).toHaveBeenCalledTimes(1));
  });

  it('says when a dropped item has no place on disk', async () => {
    const { composer } = renderFileWorkspace({ droppedPath: null });
    const surface = composer.closest('.structured-composer-surface')!;

    fireEvent.drop(surface, {
      dataTransfer: { types: ['Files'], files: [imageFile('dragged.txt', 'text/plain')] }
    });

    expect(await screen.findByText(
      'Lumora could not find where that file lives. Choose it with the file button instead.'
    )).toBeTruthy();
  });

  it('holds a message to eight files and lets one go again', async () => {
    renderFileWorkspace({
      files: Array.from({ length: 9 }, (_, index) => ({
        name: `file-${index}.txt`,
        path: `/work/file-${index}.txt`
      }))
    });

    fireEvent.click(screen.getByRole('button', { name: 'Attach files' }));

    expect(await screen.findByText('A message can point to up to 8 files.')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(8);
    fireEvent.click(screen.getByRole('button', { name: 'Remove file-0.txt' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
  });

  it('offers images and files from one attach entry', async () => {
    const picker = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    try {
      const { chooseStructuredFiles } = renderFileWorkspace({
        acceptsImages: true,
        files: [{ name: 'notes.md', path: '/work/notes.md' }]
      });

      fireEvent.click(screen.getByRole('button', { name: 'Attach' }));
      expect(screen.getByRole('menuitem', { name: 'Attach images' })).toBeTruthy();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Attach files' }));

      expect(chooseStructuredFiles).toHaveBeenCalledWith({ connectionId: 'connection-1' });
      expect(await screen.findByText('notes.md')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Attach' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Attach images' }));
      expect(picker).toHaveBeenCalled();
    } finally {
      picker.mockRestore();
    }
  });

  it('shows a question the agent asked and sends the answer back through the runtime', async () => {
    const dispatchStructuredAgentAction = vi.fn(async () => undefined);
    const api = { dispatchStructuredAgentAction } as unknown as LumoraApi;
    renderWithLocalization(
      <StructuredAgentWorkspace
        activeConnectionId="connection-1"
        api={api}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onReconnect={vi.fn()}
        snapshots={[{
          ...snapshot,
          events: [{
            connectionId: 'connection-1', providerId: 'codex', nativeSessionId: 'native-1',
            turnId: 'turn-1', eventId: 'event-1', parentEventId: null, sequence: 1,
            generation: 1, timestamp: '2026-08-27T00:00:01.000Z', kind: 'question.requested',
            payload: {
              requestId: 'codex-question-7',
              source: 'agent',
              serverName: null,
              message: null,
              link: null,
              questions: [{
                id: 'question-0', header: 'Target', prompt: 'Where should this deploy?',
                answer: 'choice',
                options: [{ label: 'Staging', description: null }, { label: 'Production', description: null }],
                multiSelect: false, allowOther: false, secret: false, required: true
              }]
            }
          }]
        }]}
      />
    );

    expect(screen.getByText('Codex is asking')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Production' }));
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));

    await waitFor(() => expect(dispatchStructuredAgentAction).toHaveBeenCalledWith({
      kind: 'question.respond',
      connectionId: 'connection-1',
      requestId: 'codex-question-7',
      outcome: 'answer',
      answers: { 'question-0': ['Production'] }
    }));
  });

  it('offers the modes an agent has at the left of the message box and switches them', async () => {
    const modeSnapshot: StructuredAgentRuntimeSnapshot = {
      ...snapshot,
      commands: [{
        id: 'mode',
        name: '/mode',
        description: 'Choose whether Codex plans first or works directly.',
        descriptionKey: 'terminal.unified.commands.mode',
        inputHint: '<mode>',
        choices: [
          { value: 'default', label: 'Default', labelKey: 'terminal.unified.modes.default', description: null },
          { value: 'plan', label: 'Plan', labelKey: 'terminal.unified.modes.plan', description: null }
        ],
        selectedValue: 'default',
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
        snapshots={[modeSnapshot]}
      />
    );

    const modeSelector = screen.getByRole('button', { name: 'Mode' });
    // How the agent works sits with attaching, away from the model and Send.
    expect(modeSelector.closest('.structured-composer-attachments')).not.toBeNull();
    fireEvent.click(modeSelector);
    fireEvent.click(screen.getByRole('option', { name: 'Plan' }));

    await vi.waitFor(() => expect(dispatchStructuredAgentAction).toHaveBeenCalledWith({
      kind: 'command.execute',
      connectionId: 'connection-1',
      commandId: 'mode',
      argument: 'plan'
    }));
  });

  it('shows no mode picker for an agent without modes', () => {
    renderWorkspace();

    expect(screen.queryByRole('button', { name: 'Mode' })).toBeNull();
  });

  it('sends a message straight into the turn for an agent that can take it', async () => {
    const dispatchStructuredAgentAction = vi.fn(async () => undefined);
    renderWithLocalization(
      <StructuredAgentWorkspace
        activeConnectionId="connection-1"
        api={{ dispatchStructuredAgentAction } as unknown as LumoraApi}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onReconnect={vi.fn()}
        snapshots={[workingSnapshot(true)]}
      />
    );
    const composer = screen.getByRole('textbox', { name: 'Message Codex' });

    // A command typed out is not a message to send into the turn.
    fireEvent.change(composer, { target: { value: '/compact' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to Codex now' }));
    expect(dispatchStructuredAgentAction).not.toHaveBeenCalled();

    fireEvent.change(composer, { target: { value: 'Also update the docs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to Codex now' }));

    expect(dispatchStructuredAgentAction).toHaveBeenCalledWith({
      kind: 'prompt.submit',
      connectionId: 'connection-1',
      text: 'Also update the docs',
      attachmentTokens: []
    });
    expect(screen.getByRole('button', { name: 'Cancel turn' })).toBeInTheDocument();
    await waitFor(() => expect(composer).toHaveValue(''));
  });

  it('sends a waiting message once the turn ends, and one per turn', async () => {
    const dispatchStructuredAgentAction = vi.fn(async () => undefined);
    const api = { dispatchStructuredAgentAction } as unknown as LumoraApi;
    const view = (snapshots: StructuredAgentRuntimeSnapshot[]) => (
      <StructuredAgentWorkspace
        activeConnectionId="connection-1"
        api={api}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onReconnect={vi.fn()}
        snapshots={snapshots}
      />
    );
    const { rerender } = renderWithLocalization(view([workingSnapshot(false)]));
    const composer = screen.getByRole('textbox', { name: 'Message Codex' });

    fireEvent.change(composer, { target: { value: 'First follow-up' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send when Codex finishes' }));
    fireEvent.change(composer, { target: { value: 'Second follow-up' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send when Codex finishes' }));
    expect(dispatchStructuredAgentAction).not.toHaveBeenCalled();

    rerender(view([workingSnapshot(false, [turnEvent(5, 'turn-2', 'turn.completed', 'completed')])]));

    await waitFor(() => expect(dispatchStructuredAgentAction).toHaveBeenCalledTimes(1));
    expect(dispatchStructuredAgentAction).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'prompt.submit',
      text: 'First follow-up'
    }));
    await waitFor(() => expect(
      screen.getByRole('list', { name: 'Messages waiting for Codex' })
    ).not.toHaveTextContent('First follow-up'));
    // The second waits for the turn the first one starts.
    expect(dispatchStructuredAgentAction).toHaveBeenCalledTimes(1);
  });

  it('lets a waiting message be withdrawn before the turn ends', async () => {
    const dispatchStructuredAgentAction = vi.fn(async () => undefined);
    const api = { dispatchStructuredAgentAction } as unknown as LumoraApi;
    const view = (snapshots: StructuredAgentRuntimeSnapshot[]) => (
      <StructuredAgentWorkspace
        activeConnectionId="connection-1"
        api={api}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onReconnect={vi.fn()}
        snapshots={snapshots}
      />
    );
    const { rerender } = renderWithLocalization(view([workingSnapshot(false)]));
    fireEvent.change(screen.getByRole('textbox', { name: 'Message Codex' }), {
      target: { value: 'Never mind' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send when Codex finishes' }));

    fireEvent.click(screen.getByRole('button', { name: 'Remove waiting message' }));
    expect(screen.queryByRole('list', { name: 'Messages waiting for Codex' })).not.toBeInTheDocument();
    rerender(view([workingSnapshot(false, [turnEvent(5, 'turn-2', 'turn.completed', 'completed')])]));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(dispatchStructuredAgentAction).not.toHaveBeenCalled();
  });

  it('shows a message sent into a turn beneath the prompt that started it', () => {
    renderWithLocalization(
      <StructuredAgentWorkspace
        activeConnectionId="connection-1"
        api={{ dispatchStructuredAgentAction: vi.fn() } as unknown as LumoraApi}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onReconnect={vi.fn()}
        snapshots={[{
          ...snapshot,
          events: [
            ...snapshot.events,
            {
              connectionId: 'connection-1', providerId: 'codex', nativeSessionId: 'native-1',
              turnId: 'turn-1', eventId: 'event-4', parentEventId: null, sequence: 4,
              generation: 1, timestamp: '2026-08-27T00:00:04.000Z', kind: 'user.message',
              payload: { text: 'Skip the flaky test', followUp: true }
            }
          ]
        }]}
      />
    );

    expect(screen.getByText('Fix the tests.')).toBeInTheDocument();
    expect(screen.getByText('Sent while Codex was working')).toBeInTheDocument();
    expect(screen.getByText('Skip the flaky test')).toBeInTheDocument();
  });

  it('holds a message for a turn that cannot take one, even for an agent that steers', () => {
    const dispatchStructuredAgentAction = vi.fn(async () => undefined);
    const compacting = workingSnapshot(true);
    const events = compacting.events.map((entry) => (
      entry.kind === 'turn.started' && entry.turnId === 'turn-2'
        ? { ...entry, payload: { ...entry.payload, steerable: false } }
        : entry
    ));
    renderWithLocalization(
      <StructuredAgentWorkspace
        activeConnectionId="connection-1"
        api={{ dispatchStructuredAgentAction } as unknown as LumoraApi}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onReconnect={vi.fn()}
        snapshots={[{ ...compacting, events }]}
      />
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Message Codex' }), {
      target: { value: 'After the compaction' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send when Codex finishes' }));

    expect(dispatchStructuredAgentAction).not.toHaveBeenCalled();
    expect(screen.getByRole('list', { name: 'Messages waiting for Codex' })).toHaveTextContent('After the compaction');
  });

  it('marks a waiting message that could not be sent, and sends it again when asked', async () => {
    const dispatchStructuredAgentAction = vi.fn()
      .mockRejectedValueOnce(new Error('The agent is busy.'))
      .mockResolvedValue(undefined);
    const api = { dispatchStructuredAgentAction } as unknown as LumoraApi;
    const view = (snapshots: StructuredAgentRuntimeSnapshot[]) => (
      <StructuredAgentWorkspace
        activeConnectionId="connection-1"
        api={api}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onReconnect={vi.fn()}
        snapshots={snapshots}
      />
    );
    const { rerender } = renderWithLocalization(view([workingSnapshot(false)]));
    fireEvent.change(screen.getByRole('textbox', { name: 'Message Codex' }), {
      target: { value: 'Try this next' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send when Codex finishes' }));
    const ended = [workingSnapshot(false, [turnEvent(5, 'turn-2', 'turn.completed', 'completed')])];

    rerender(view(ended));
    expect(await screen.findByText('Not sent')).toBeInTheDocument();
    // It is not retried on its own.
    rerender(view([...ended]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(dispatchStructuredAgentAction).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Send again' }));
    await waitFor(() => expect(dispatchStructuredAgentAction).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(
      screen.queryByRole('list', { name: 'Messages waiting for Codex' })
    ).not.toBeInTheDocument());
  });

  it('does not run a command picked from the list while a turn is running', () => {
    const dispatchStructuredAgentAction = vi.fn(async () => undefined);
    renderWithLocalization(
      <StructuredAgentWorkspace
        activeConnectionId="connection-1"
        api={{ dispatchStructuredAgentAction } as unknown as LumoraApi}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onReconnect={vi.fn()}
        snapshots={[workingSnapshot(true)]}
      />
    );
    const composer = screen.getByRole('textbox', { name: 'Message Codex' });

    fireEvent.change(composer, { target: { value: '/comp' } });
    fireEvent.keyDown(composer, { key: 'Enter' });

    expect(dispatchStructuredAgentAction).not.toHaveBeenCalled();
  });
});

describe('StructuredAgentWorkspace changes', () => {
  const second: StructuredAgentRuntimeSnapshot = {
    ...snapshot,
    runtime: { ...snapshot.runtime, connectionId: 'connection-2', title: 'Release notes' },
    events: []
  };

  function renderChanges(options: { changesEnabled?: boolean } = {}) {
    const { api: changesApi, emit } = fakeChangesApi();
    const api = {
      ...changesApi,
      dispatchStructuredAgentAction: vi.fn(async () => undefined)
    } as unknown as LumoraApi;
    const props = {
      api,
      changeCounts: new Map([['connection-1', 5], ['connection-2', 2]]),
      onActivate: vi.fn(),
      onClose: vi.fn(),
      onReconnect: vi.fn(),
      snapshots: [snapshot, second]
    };
    const view = renderWithLocalization(
      <StructuredAgentWorkspace
        {...props}
        activeConnectionId="connection-1"
        changesEnabled={options.changesEnabled ?? true}
      />
    );
    const activate = (connectionId: string) => view.rerender(
      <StructuredAgentWorkspace {...props} activeConnectionId={connectionId} changesEnabled />
    );
    return { activate, changesApi, emit, props, view };
  }

  const section = () => document.querySelector('.structured-agent-workspace') as HTMLElement;
  const changesPanel = () => screen.queryByRole('complementary', { name: 'Changes' });

  it('shows change counts on the header button and on background tabs', () => {
    renderChanges();

    const button = screen.getByRole('button', { name: 'Changes 5' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveClass('icon-button', 'changes-button');
    // The count rides on the mark rather than in a word beside it.
    expect(button).toHaveTextContent('5');
    expect(screen.getByRole('tab', { name: /Release notes/ })).toHaveTextContent('2 changed');
    expect(screen.getByRole('tab', { name: /Repository cleanup/ })).not.toHaveTextContent('changed');
  });

  it('keeps focus in the changes panel when the session becomes ready again', async () => {
    const { changesApi, props, view } = renderChanges();
    fireEvent.click(screen.getByRole('button', { name: 'Changes 5' }));
    await act(async () => undefined);
    const panel = changesPanel() as HTMLElement;
    // Only a reader who moved into the panel themselves holds focus there.
    panel.querySelector<HTMLElement>('button.changes-file-select')?.focus();
    expect(panel.contains(document.activeElement)).toBe(true);

    const withState = (state: 'ready' | 'reconnecting') => [
      { ...snapshot, runtime: { ...snapshot.runtime, state } },
      second
    ];
    view.rerender(
      <StructuredAgentWorkspace {...props} activeConnectionId="connection-1" changesEnabled snapshots={withState('reconnecting')} />
    );
    view.rerender(
      <StructuredAgentWorkspace
        {...props}
        activeConnectionId="connection-1"
        changesEnabled
        focusRequestKey={1}
        snapshots={withState('ready')}
      />
    );

    expect(changesPanel()?.contains(document.activeElement)).toBe(true);
    expect(screen.getByRole('textbox')).not.toHaveFocus();
    expect(changesApi.getChangesSummary).toHaveBeenCalled();
  });

  it('pauses the changes panel while the Unified UI surface is hidden', async () => {
    const { changesApi, emit, props, view } = renderChanges();
    fireEvent.click(screen.getByRole('button', { name: 'Changes 5' }));
    await waitFor(() => expect(changesApi.getChangesSummary).toHaveBeenCalledTimes(1));

    view.rerender(
      <StructuredAgentWorkspace {...props} activeConnectionId="connection-1" changesEnabled visible={false} />
    );
    await act(async () => emit('connection-1'));

    expect(changesApi.getChangesSummary).toHaveBeenCalledTimes(1);
  });

  it('opens the session changes beside the conversation and closes them again', async () => {
    const { changesApi } = renderChanges();

    fireEvent.click(screen.getByRole('button', { name: 'Changes 5' }));

    const panel = changesPanel();
    expect(panel?.parentElement).toBe(section());
    expect(section()).toHaveClass('has-changes-panel');
    // Opening takes no focus: the composer keeps the keyboard.
    expect(panel?.contains(document.activeElement)).toBe(false);
    await waitFor(() => expect(changesApi.getChangesSummary).toHaveBeenCalledWith({
      kind: 'session', ownerId: 'connection-1', view: 'session'
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Maximize changes' }));
    expect(section()).toHaveClass('changes-maximized');

    fireEvent.click(screen.getByRole('button', { name: 'Close changes' }));
    expect(changesPanel()).toBeNull();
    expect(section()).not.toHaveClass('changes-maximized');
    expect(screen.getByRole('button', { name: 'Changes 5' })).not.toHaveFocus();
  });

  it('keeps each tab its own changes panel state', async () => {
    const { activate } = renderChanges();
    fireEvent.click(screen.getByRole('button', { name: 'Changes 5' }));
    await act(async () => undefined);

    activate('connection-2');
    expect(changesPanel()).toBeNull();
    expect(screen.getByRole('button', { name: 'Changes 2' })).toHaveAttribute('aria-expanded', 'false');

    activate('connection-1');
    expect(changesPanel()).not.toBeNull();
    await act(async () => undefined);
  });

  it('offers no changes unless enabled', () => {
    renderChanges({ changesEnabled: false });

    expect(screen.queryByRole('button', { name: /^Changes/ })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Release notes/ })).not.toHaveTextContent('changed');
  });
});
