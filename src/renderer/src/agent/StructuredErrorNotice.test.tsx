import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { StructuredAgentEvent } from '../../../shared/contracts';
import { renderWithLocalization } from '../test/render-with-localization';
import { StructuredErrorNotice } from './StructuredErrorNotice';

type AgentError = Extract<StructuredAgentEvent, { kind: 'runtime.error' }>['payload'];

function renderNotice(error: AgentError | null) {
  return renderWithLocalization(<StructuredErrorNotice error={error} providerName="Codex" />);
}

describe('StructuredErrorNotice', () => {
  it('says a usage limit in the user\'s language and when it lifts, without English filler', () => {
    const { container } = renderNotice({
      code: 'CLAUDE_USAGE_LIMIT',
      message: 'Claude reached a usage limit.',
      retryable: false,
      errorKind: 'usage_limit',
      providerMessage: null,
      attempt: null,
      resetsAt: 1_788_000_000
    });

    expect(screen.getByText('Codex has reached a usage limit.')).toBeTruthy();
    expect(screen.getByText(/^The limit resets /)).toBeTruthy();
    // Lumora's own fallback words are for logs; the user gets the kind instead.
    expect(container.textContent).not.toContain('Claude reached a usage limit.');
  });

  it('shows the provider\'s own words beneath the kind', () => {
    renderNotice({
      code: 'CODEX_RUNTIME_ERROR',
      message: 'Codex reported a structured runtime error.',
      retryable: false,
      errorKind: 'other',
      providerMessage: 'Tool output exceeded the limit.',
      attempt: null,
      resetsAt: null
    });

    expect(screen.getByText('Codex reported an error.')).toBeTruthy();
    expect(screen.getByText('Tool output exceeded the limit.')).toBeTruthy();
  });

  it('says which attempt a retry is on', () => {
    renderNotice({
      code: 'CLAUDE_API_RETRY',
      message: 'Claude is retrying after an API error.',
      retryable: true,
      errorKind: 'overloaded',
      providerMessage: null,
      attempt: { current: 2, max: 10 },
      resetsAt: null
    });

    expect(screen.getByText("Codex's service is overloaded or unavailable.")).toBeTruthy();
    expect(screen.getByText('Trying again: attempt 2 of 10.')).toBeTruthy();
  });

  it('shows an error without a kind as its message, and a failed action generically', () => {
    renderNotice({
      code: 'CLAUDE_QUERY_STOPPED',
      message: 'Claude stopped before the turn completed.',
      retryable: true
    });
    expect(screen.getByText('Claude stopped before the turn completed.')).toBeTruthy();
  });

  it('falls back to the generic failure when there is no agent error at all', () => {
    const { container } = renderNotice(null);
    expect(container.textContent?.trim().length).toBeGreaterThan(0);
  });
});
