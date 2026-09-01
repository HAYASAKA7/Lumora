import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterAll, bench, describe, vi } from 'vitest';

import type {
  LumoraApi,
  StructuredAgentRuntimeSnapshot
} from '../../../shared/contracts';
import { renderWithLocalization } from '../test/render-with-localization';
import { AgentMarkdown } from './AgentMarkdown';
import { StructuredAgentWorkspace } from './StructuredAgentWorkspace';

const turnCount = 200;
const responsePadding = 'Renderer benchmark content. '.repeat(40);
let maximumMountedTurnCount = 0;
let maximumDomNodeCount = 0;
const markdownProbeNodeCounts = new Map<number, number>();

const events: StructuredAgentRuntimeSnapshot['events'] = Array.from(
  { length: turnCount },
  (_, index) => {
    const turn = index + 1;
    return [{
      connectionId: 'benchmark-connection',
      providerId: 'codex' as const,
      nativeSessionId: 'benchmark-native',
      turnId: `benchmark-turn-${turn}`,
      eventId: `benchmark-user-${turn}`,
      parentEventId: null,
      sequence: turn * 2,
      generation: 1,
      timestamp: '2026-09-01T00:00:00.000Z',
      kind: 'user.message' as const,
      payload: { text: `Benchmark request ${turn}` }
    }, {
      connectionId: 'benchmark-connection',
      providerId: 'codex' as const,
      nativeSessionId: 'benchmark-native',
      turnId: `benchmark-turn-${turn}`,
      eventId: `benchmark-assistant-${turn}`,
      parentEventId: null,
      sequence: turn * 2 + 1,
      generation: 1,
      timestamp: '2026-09-01T00:00:01.000Z',
      kind: 'assistant.message' as const,
      payload: {
        text: `## Benchmark response ${turn}\n\n${responsePadding}\n\n- Result A\n- Result B`
      }
    }];
  }
).flat();

const snapshot: StructuredAgentRuntimeSnapshot = {
  runtime: {
    connectionId: 'benchmark-connection',
    providerId: 'codex',
    nativeSessionId: 'benchmark-native',
    catalogSessionId: 'benchmark-session',
    workspaceId: 'benchmark-workspace',
    title: 'Long renderer benchmark',
    state: 'ready',
    generation: 1,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    error: null
  },
  boundary: null,
  commands: [],
  events
};

function renderBenchmarkWorkspace() {
  return renderWithLocalization(
    <StructuredAgentWorkspace
      activeConnectionId="benchmark-connection"
      api={{
        dispatchStructuredAgentAction: vi.fn(async () => undefined)
      } as unknown as LumoraApi}
      onActivate={vi.fn()}
      onClose={vi.fn()}
      onReconnect={vi.fn()}
      snapshots={[snapshot]}
    />
  );
}

function recordMountedSize(container: HTMLElement): void {
  maximumMountedTurnCount = Math.max(
    maximumMountedTurnCount,
    container.querySelectorAll('.structured-turn').length
  );
  maximumDomNodeCount = Math.max(
    maximumDomNodeCount,
    container.querySelectorAll('*').length
  );
}

function renderMarkdownProbe(count: number): void {
  const view = renderWithLocalization(
    <div className="structured-conversation">
      {Array.from({ length: count }, (_, index) => (
        <article className="structured-turn" key={index}>
          <AgentMarkdown onOpenLink={() => undefined}>
            {`## Benchmark response ${index + 1}\n\n${responsePadding}\n\n- Result A\n- Result B`}
          </AgentMarkdown>
        </article>
      ))}
    </div>
  );
  markdownProbeNodeCounts.set(
    count,
    Math.max(
      markdownProbeNodeCounts.get(count) ?? 0,
      view.container.querySelectorAll('*').length
    )
  );
  cleanup();
}

describe('structured Markdown render scale', () => {
  bench('renders the adaptive five-turn window', () => {
    renderMarkdownProbe(5);
  }, { iterations: 20, warmupIterations: 2 });

  bench('renders the former 24-turn window', () => {
    renderMarkdownProbe(24);
  }, { iterations: 10, warmupIterations: 2 });

  bench('renders a complete 200-turn history', () => {
    renderMarkdownProbe(200);
  }, { iterations: 5, warmupIterations: 1 });
});

describe('structured agent history window', () => {
  bench('initially renders a 200-turn Markdown session', async () => {
    const view = renderBenchmarkWorkspace();
    await screen.findByText('Benchmark response 200');
    recordMountedSize(view.container);
    cleanup();
  }, { iterations: 20, warmupIterations: 2 });

  bench('prepends one bounded page at the top edge', async () => {
    const view = renderBenchmarkWorkspace();
    await screen.findByText('Benchmark response 200');
    const body = view.container.querySelector('.structured-agent-body') as HTMLDivElement;
    Object.defineProperty(body, 'clientHeight', { configurable: true, value: 600 });
    Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 2_400 });
    body.scrollTop = 0;
    fireEvent.scroll(body);
    await screen.findByText('Benchmark response 191');
    recordMountedSize(view.container);
    cleanup();
  }, { iterations: 20, warmupIterations: 2 });
});

afterAll(() => {
  console.info(
    `Structured-agent benchmark maximum mounted turns: ${maximumMountedTurnCount}; ` +
    `maximum workspace DOM nodes: ${maximumDomNodeCount}; source turns: ${turnCount}; ` +
    `Markdown probe DOM nodes (5/24/200 turns): ` +
    `${markdownProbeNodeCounts.get(5) ?? 0}/` +
    `${markdownProbeNodeCounts.get(24) ?? 0}/` +
    `${markdownProbeNodeCounts.get(200) ?? 0}.`
  );
});
