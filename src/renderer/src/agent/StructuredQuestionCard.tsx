import { useId, useState, type ReactNode } from 'react';

import type { StructuredQuestion } from '../../../shared/contracts';
import { useLocalization } from '../localization/useLocalization';
import type { StructuredAgentQuestionView } from './structured-agent-state';

type Answers = Record<string, string[]>;

interface StructuredQuestionCardProps {
  request: StructuredAgentQuestionView;
  providerName: string;
  disabled: boolean;
  onOpenLink(url: string): void;
  onRespond(outcome: 'answer' | 'decline', answers: Answers): Promise<void>;
}

/** What one question's inputs amount to, in the form the respond action takes. */
function answerFor(
  question: StructuredQuestion,
  selected: readonly string[],
  typed: string
): string[] {
  const text = typed.trim();
  if (question.answer === 'choice') {
    const other = question.allowOther && text !== '' ? [text] : [];
    // One answer to a single choice: a typed answer stands in for the options.
    if (!question.multiSelect) return other.length > 0 ? other : selected.slice(0, 1);
    return [...selected, ...other];
  }
  if (question.answer === 'boolean') return [...selected];
  return text === '' ? [] : [text];
}

/**
 * A question the agent asked, answered in place. The card holds what the user
 * has chosen or typed only until it is sent; once the question is settled it
 * shows the outcome and nothing of the answer, so a secret never lingers.
 */
export function StructuredQuestionCard({
  request,
  providerName,
  disabled,
  onOpenLink,
  onRespond
}: StructuredQuestionCardProps): ReactNode {
  const { t } = useLocalization();
  const idPrefix = useId();
  const [selections, setSelections] = useState<Readonly<Record<string, readonly string[]>>>({});
  const [texts, setTexts] = useState<Readonly<Record<string, string>>>({});
  const [sending, setSending] = useState(false);

  const heading = request.source === 'mcp'
    ? t('terminal.unified.question-mcp-title', {
      server: request.serverName ?? providerName
    })
    : t('terminal.unified.question-agent-title', { provider: providerName });

  if (request.outcome !== null) {
    return (
      <section className="structured-question structured-question-settled">
        <strong>{heading}</strong>
        <p className="structured-question-outcome">
          {t(`terminal.unified.question-${request.outcome}`)}
        </p>
      </section>
    );
  }

  const answers: Answers = Object.fromEntries(request.questions.map((question) => [
    question.id,
    answerFor(question, selections[question.id] ?? [], texts[question.id] ?? '')
  ]));
  const complete = request.questions.every((question) => (
    !question.required || (answers[question.id]?.length ?? 0) > 0
  ));
  const numbersValid = request.questions.every((question) => {
    if (question.answer !== 'number') return true;
    const value = texts[question.id]?.trim() ?? '';
    return value === '' || Number.isFinite(Number(value));
  });

  const choose = (question: StructuredQuestion, value: string) => {
    if (!question.multiSelect && question.allowOther) {
      // Picking an option replaces whatever was typed as a single answer.
      setTexts((current) => ({ ...current, [question.id]: '' }));
    }
    setSelections((current) => {
      const chosen = current[question.id] ?? [];
      if (!question.multiSelect) return { ...current, [question.id]: [value] };
      return {
        ...current,
        [question.id]: chosen.includes(value)
          ? chosen.filter((item) => item !== value)
          : [...chosen, value]
      };
    });
  };

  const respond = (outcome: 'answer' | 'decline') => {
    setSending(true);
    void onRespond(outcome, outcome === 'decline' ? {} : answers)
      .then(() => {
        // The answer has gone; nothing of it stays in the page.
        setSelections({});
        setTexts({});
      }, () => undefined)
      .finally(() => setSending(false));
  };

  const locked = disabled || sending;
  const onlyLink = request.questions.length === 0;

  return (
    <section className="structured-question" aria-labelledby={`${idPrefix}-heading`}>
      <strong id={`${idPrefix}-heading`}>{heading}</strong>
      {request.message === null ? null : (
        <p className="structured-question-message">{request.message}</p>
      )}
      {request.link === null ? null : (
        <button
          className="secondary-button structured-question-link"
          data-lumora-command
          disabled={locked}
          onClick={() => onOpenLink(request.link!)}
          type="button"
        >
          {t('terminal.unified.question-open-link')}
        </button>
      )}
      {request.questions.map((question) => {
        const promptId = `${idPrefix}-${question.id}-prompt`;
        const chosen = selections[question.id] ?? [];
        return (
          <fieldset className="structured-question-item" key={question.id}>
            <legend id={promptId}>
              {question.header === null ? null : (
                <span className="structured-question-header">{question.header}</span>
              )}
              <span className="structured-question-prompt">{question.prompt}</span>
              {question.required ? null : (
                <span className="structured-question-optional">
                  {t('terminal.unified.question-optional')}
                </span>
              )}
            </legend>
            {question.answer === 'choice' ? (
              <div
                aria-labelledby={promptId}
                className="structured-question-options"
                role="group"
              >
                {question.options.map((option) => (
                  <button
                    aria-pressed={chosen.includes(option.label)}
                    className="structured-question-option"
                    data-lumora-command
                    disabled={locked}
                    key={option.label}
                    onClick={() => choose(question, option.label)}
                    type="button"
                  >
                    <span>{option.label}</span>
                    {option.description === null ? null : <small>{option.description}</small>}
                  </button>
                ))}
              </div>
            ) : null}
            {question.answer === 'boolean' ? (
              <div
                aria-labelledby={promptId}
                className="structured-question-options"
                role="group"
              >
                {(['true', 'false'] as const).map((value) => (
                  <button
                    aria-pressed={chosen.includes(value)}
                    className="structured-question-option"
                    data-lumora-command
                    disabled={locked}
                    key={value}
                    onClick={() => choose(question, value)}
                    type="button"
                  >
                    <span>{t(value === 'true' ? 'terminal.unified.question-yes' : 'terminal.unified.question-no')}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {question.answer === 'text' ||
            question.answer === 'number' ||
            (question.answer === 'choice' && question.allowOther) ? (
              <input
                aria-labelledby={question.answer === 'choice' ? undefined : promptId}
                aria-label={question.answer === 'choice'
                  ? t('terminal.unified.question-other')
                  : undefined}
                autoComplete="off"
                className="structured-question-input"
                disabled={locked}
                inputMode={question.answer === 'number' ? 'decimal' : undefined}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setTexts((current) => ({ ...current, [question.id]: value }));
                  if (question.answer === 'choice' && !question.multiSelect && value.trim() !== '') {
                    // Typing an answer of one's own replaces a picked option.
                    setSelections((current) => ({ ...current, [question.id]: [] }));
                  }
                }}
                placeholder={question.answer === 'choice'
                  ? t('terminal.unified.question-other-placeholder')
                  : t('terminal.unified.question-text-placeholder')}
                spellCheck={false}
                type={question.secret ? 'password' : 'text'}
                value={texts[question.id] ?? ''}
              />
            ) : null}
          </fieldset>
        );
      })}
      <div className="catalog-actions">
        <button
          className="refresh-button"
          data-lumora-command
          disabled={locked || !complete || !numbersValid}
          onClick={() => respond('answer')}
          type="button"
        >
          {t(onlyLink ? 'terminal.unified.question-done' : 'terminal.unified.question-answer')}
        </button>
        <button
          className="secondary-button"
          data-lumora-command
          disabled={locked}
          onClick={() => respond('decline')}
          type="button"
        >
          {t('terminal.unified.question-decline')}
        </button>
      </div>
    </section>
  );
}
