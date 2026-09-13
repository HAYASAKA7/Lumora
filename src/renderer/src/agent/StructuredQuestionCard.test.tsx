import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { StructuredQuestion } from '../../../shared/contracts';
import { renderWithLocalization } from '../test/render-with-localization';
import type { StructuredAgentQuestionView } from './structured-agent-state';
import { StructuredQuestionCard } from './StructuredQuestionCard';

function question(overrides: Partial<StructuredQuestion> = {}): StructuredQuestion {
  return {
    id: 'question-0',
    header: 'Target',
    prompt: 'Where should this deploy?',
    answer: 'choice',
    options: [
      { label: 'Staging', description: 'Safe to break' },
      { label: 'Production', description: null }
    ],
    multiSelect: false,
    allowOther: false,
    secret: false,
    required: true,
    ...overrides
  };
}

function request(overrides: Partial<StructuredAgentQuestionView> = {}): StructuredAgentQuestionView {
  return {
    id: 'codex-question-7',
    source: 'agent',
    serverName: null,
    message: null,
    link: null,
    questions: [question()],
    outcome: null,
    ...overrides
  };
}

function renderCard(view: StructuredAgentQuestionView) {
  const onRespond = vi.fn(async () => undefined);
  const onOpenLink = vi.fn();
  renderWithLocalization(
    <StructuredQuestionCard
      disabled={false}
      onOpenLink={onOpenLink}
      onRespond={onRespond}
      providerName="Codex"
      request={view}
    />
  );
  const answerButton = () => screen.getByRole('button', { name: /^(Answer|Done)$/ }) as HTMLButtonElement;
  return { answerButton, onOpenLink, onRespond };
}

describe('StructuredQuestionCard', () => {
  it('asks in the agent\'s name and waits for a choice before answering', async () => {
    const { answerButton, onRespond } = renderCard(request());

    expect(screen.getByText('Codex is asking')).toBeTruthy();
    expect(screen.getByText('Safe to break')).toBeTruthy();
    expect(answerButton().disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /Staging/ }));
    expect(screen.getByRole('button', { name: /Staging/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(answerButton());

    await waitFor(() => expect(onRespond).toHaveBeenCalledWith('answer', { 'question-0': ['Staging'] }));
  });

  it('switches a single choice, toggles a multiple one, and adds a typed answer of the user\'s own', () => {
    const { answerButton, onRespond } = renderCard(request({
      questions: [
        question(),
        question({
          id: 'question-1',
          header: null,
          prompt: 'Which checks?',
          options: [{ label: 'Lint', description: null }, { label: 'Tests', description: null }],
          multiSelect: true,
          allowOther: true
        })
      ]
    }));

    fireEvent.click(screen.getByRole('button', { name: /Staging/ }));
    fireEvent.click(screen.getByRole('button', { name: /Production/ }));
    fireEvent.click(screen.getByRole('button', { name: /Lint/ }));
    fireEvent.click(screen.getByRole('button', { name: /Tests/ }));
    fireEvent.click(screen.getByRole('button', { name: /Tests/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Other' }), { target: { value: ' Types ' } });
    fireEvent.click(answerButton());

    expect(onRespond).toHaveBeenCalledWith('answer', {
      'question-0': ['Production'],
      'question-1': ['Lint', 'Types']
    });
  });

  it('gives a single choice one answer: an option or a typed answer, never both', () => {
    const { answerButton, onRespond } = renderCard(request({
      questions: [question({ allowOther: true })]
    }));
    const other = screen.getByRole('textbox', { name: 'Other' }) as HTMLInputElement;

    // Picking an option clears what was typed…
    fireEvent.change(other, { target: { value: 'Canary' } });
    fireEvent.click(screen.getByRole('button', { name: /Production/ }));
    expect(other.value).toBe('');
    expect(screen.getByRole('button', { name: /Production/ }).getAttribute('aria-pressed')).toBe('true');

    // …and typing clears the option that was picked.
    fireEvent.change(other, { target: { value: 'Canary' } });
    expect(screen.getByRole('button', { name: /Production/ }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(answerButton());

    expect(onRespond).toHaveBeenCalledWith('answer', { 'question-0': ['Canary'] });
  });

  it('hides a secret as it is typed and forgets it once sent', async () => {
    const { answerButton, onRespond } = renderCard(request({
      questions: [question({ answer: 'text', options: [], secret: true, prompt: 'Paste the token.' })]
    }));
    const secret = document.querySelector('input[type="password"]') as HTMLInputElement;

    expect(secret).not.toBeNull();
    fireEvent.change(secret, { target: { value: 's3cret' } });
    fireEvent.click(answerButton());

    await waitFor(() => expect(onRespond).toHaveBeenCalledWith('answer', { 'question-0': ['s3cret'] }));
    await waitFor(() => expect(secret.value).toBe(''));
  });

  it('takes yes or no, refuses a non-number, and does not wait on an optional question', () => {
    const { answerButton, onRespond } = renderCard(request({
      source: 'mcp',
      serverName: 'deploy-server',
      message: 'Confirm the rollout.',
      questions: [
        question({ id: 'field-0', answer: 'boolean', options: [], prompt: 'Notify the team?' }),
        question({ id: 'field-1', answer: 'number', options: [], prompt: 'Replicas' }),
        question({ id: 'field-2', answer: 'text', options: [], prompt: 'Note', required: false })
      ]
    }));

    expect(screen.getByText('deploy-server needs your input')).toBeTruthy();
    expect(screen.getByText('Confirm the rollout.')).toBeTruthy();
    expect(screen.getByText('Optional')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0]!, { target: { value: 'three' } });
    expect(answerButton().disabled).toBe(true);
    fireEvent.change(inputs[0]!, { target: { value: '3' } });
    expect(answerButton().disabled).toBe(false);
    fireEvent.click(answerButton());

    expect(onRespond).toHaveBeenCalledWith('answer', {
      'field-0': ['true'],
      'field-1': ['3'],
      'field-2': []
    });
  });

  it('offers a page to open, then Done, and lets the user decline instead', () => {
    const { answerButton, onOpenLink, onRespond } = renderCard(request({
      source: 'mcp',
      serverName: 'docs-server',
      message: 'Sign in to continue.',
      link: 'https://example.com/sign-in',
      questions: []
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Open page' }));
    expect(onOpenLink).toHaveBeenCalledWith('https://example.com/sign-in');
    expect(answerButton().textContent).toBe('Done');
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));

    expect(onRespond).toHaveBeenCalledWith('decline', {});
  });

  it('settles to its outcome and shows nothing of the answer', () => {
    renderCard(request({ outcome: 'answered' }));

    expect(screen.getByText('Answered')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Staging/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Answer' })).toBeNull();
  });
});
