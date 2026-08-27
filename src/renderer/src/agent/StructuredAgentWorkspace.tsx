import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CompositionEvent,
  type KeyboardEvent,
  type ReactNode
} from 'react';

import type {
  LumoraApi,
  StructuredAgentApprovalDecision,
  StructuredAgentRuntimeSnapshot
} from '../../../shared/contracts';
import { providerDefinition } from '../../../shared/provider-definitions';
import { OverflowTooltip } from '../ui/Tooltip';
import { useLocalization } from '../localization/useLocalization';
import {
  createStructuredAgentViewState,
  reduceStructuredAgentEvent
} from './structured-agent-state';

interface StructuredAgentWorkspaceProps {
  api?: LumoraApi;
  activeConnectionId: string;
  focusRequestKey?: number;
  snapshots: readonly StructuredAgentRuntimeSnapshot[];
  showTabBar?: boolean;
  onActivate(connectionId: string): void;
  onReconnect(connectionId: string): void;
}

const approvalKeys: Record<StructuredAgentApprovalDecision, string> = {
  allow_once: 'terminal.unified.allow-once',
  allow_session: 'terminal.unified.allow-session',
  deny: 'terminal.unified.deny'
};

export function StructuredAgentWorkspace({
  api = window.lumora,
  activeConnectionId,
  focusRequestKey = 0,
  snapshots,
  showTabBar = true,
  onActivate,
  onReconnect
}: StructuredAgentWorkspaceProps): ReactNode {
  const { t } = useLocalization();
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState(false);
  const composing = useRef(false);
  const composer = useRef<HTMLTextAreaElement | null>(null);
  const conversationScroller = useRef<HTMLDivElement | null>(null);
  const followLatest = useRef(true);
  const followedConnection = useRef<string | null>(null);
  const snapshot = snapshots.find(
    (candidate) => candidate.runtime.connectionId === activeConnectionId
  ) ?? snapshots[0];
  const state = useMemo(() => snapshot?.events.reduce(
    reduceStructuredAgentEvent,
    createStructuredAgentViewState()
  ) ?? createStructuredAgentViewState(), [snapshot]);
  const runtime = snapshot?.runtime;
  useEffect(() => {
    if (runtime?.state === 'ready') composer.current?.focus();
  }, [focusRequestKey, runtime?.connectionId, runtime?.state]);
  useLayoutEffect(() => {
    const scroller = conversationScroller.current;
    if (scroller === null || runtime === undefined) return;
    if (followedConnection.current !== runtime.connectionId) {
      followedConnection.current = runtime.connectionId;
      followLatest.current = true;
    }
    if (followLatest.current) scroller.scrollTop = scroller.scrollHeight;
  }, [runtime?.connectionId, state.generation, state.sequence]);
  if (snapshot === undefined || runtime === undefined) return null;

  const draft = drafts[runtime.connectionId] ?? '';
  const setDraft = (value: string) => setDrafts((current) => ({
    ...current,
    [runtime.connectionId]: value
  }));
  const providerName = providerDefinition(runtime.providerId).displayName;
  const runningTurn = state.turns.at(-1)?.status === 'running';
  const dispatch = async (action: Parameters<LumoraApi['dispatchStructuredAgentAction']>[0]) => {
    setActionError(false);
    try {
      await api.dispatchStructuredAgentAction(action);
    } catch (error) {
      setActionError(true);
      throw error;
    }
  };
  const submit = () => {
    const text = draft.trim();
    if (
      text === '' ||
      sending ||
      runningTurn ||
      runtime.state !== 'ready'
    ) return;
    setSending(true);
    void dispatch({
      kind: 'prompt.submit',
      connectionId: runtime.connectionId,
      text,
      attachmentTokens: []
    }).then(
      () => setDrafts((current) => ({
        ...current,
        [runtime.connectionId]: ''
      })),
      () => undefined
    ).finally(() => setSending(false));
  };
  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key !== 'Enter' ||
      event.shiftKey ||
      composing.current ||
      event.nativeEvent.isComposing
    ) return;
    event.preventDefault();
    submit();
  };
  const onComposition = (event: CompositionEvent<HTMLTextAreaElement>) => {
    composing.current = event.type === 'compositionstart';
  };

  return (
    <section
      aria-label={t('terminal.unified.workspace-label')}
      className="terminal-workspace structured-agent-workspace"
    >
      <div
        aria-label={t('terminal.runtime.tabs-label')}
        className="terminal-tabbar"
        hidden={!showTabBar}
        role="tablist"
      >
        {snapshots.map((item) => (
          <button
            aria-selected={item.runtime.connectionId === runtime.connectionId}
            className="terminal-tab"
            data-lumora-command
            key={item.runtime.connectionId}
            onClick={() => onActivate(item.runtime.connectionId)}
            role="tab"
            type="button"
          >
            <OverflowTooltip content={item.runtime.title}>
              <span className="terminal-tab-title">{item.runtime.title}</span>
            </OverflowTooltip>
            <small>
              {providerDefinition(item.runtime.providerId).displayName} ·{' '}
              {t(`terminal.unified.state-${item.runtime.state}`)}
            </small>
          </button>
        ))}
      </div>

      <header className="terminal-header structured-agent-header">
        <div>
          <p className="card-label">
            {t('terminal.unified.provider-context', { provider: providerName })}
          </p>
          <h2>{runtime.title}</h2>
        </div>
        <div className="catalog-actions">
          <span className={`runtime-state runtime-${runtime.state}`}>
            {t(`terminal.unified.state-${runtime.state}`)}
          </span>
          {runtime.state === 'failed' ? (
            <button className="secondary-button" data-lumora-command onClick={() => onReconnect(runtime.connectionId)} type="button">
              {t('terminal.unified.reconnect')}
            </button>
          ) : null}
        </div>
      </header>

      <div
        className="structured-agent-body"
        onScroll={(event) => {
          const scroller = event.currentTarget;
          const distanceFromBottom = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
          followLatest.current = distanceFromBottom <= 32;
        }}
        ref={conversationScroller}
      >
        {snapshot.boundary === null ? null : (
          <p className="structured-history-boundary">
            {t('terminal.unified.history-boundary')}
          </p>
        )}
        <div className="structured-conversation" aria-live="polite">
          {state.turns.map((turn) => (
            <article className="structured-turn" key={turn.id}>
              {turn.userText === '' ? null : (
                <section className="structured-message structured-message-user">
                  <strong>{t('terminal.unified.user-label')}</strong>
                  <p>{turn.userText}</p>
                </section>
              )}
              {turn.reasoning.map((reasoning, index) => (
                <details className="structured-reasoning" key={`${turn.id}-reasoning-${index}`}>
                  <summary>{t('terminal.unified.reasoning-label')}</summary>
                  <p>{reasoning}</p>
                </details>
              ))}
              {turn.activities.map((activity) => activity.kind === 'command' ? (
                <details
                  className={`structured-activity structured-activity-command structured-activity-${activity.status}`}
                  key={activity.id}
                >
                  <summary>
                    <span className="card-label">
                      {t('terminal.unified.activity-command')}
                    </span>
                    <strong>{activity.title}</strong>
                  </summary>
                  {activity.pathLabel === null ? null : <code>{activity.pathLabel}</code>}
                  {activity.detail === null ? null : (
                    <pre className="structured-activity-detail">{activity.detail}</pre>
                  )}
                </details>
              ) : (
                <section className={`structured-activity structured-activity-${activity.status}`} key={activity.id}>
                  <span className="card-label">
                    {t(`terminal.unified.activity-${activity.kind}`)}
                  </span>
                  <strong>{activity.title}</strong>
                  {activity.pathLabel === null ? null : <code>{activity.pathLabel}</code>}
                  {activity.detail === null ? null : <p>{activity.detail}</p>}
                </section>
              ))}
              {turn.plan.length === 0 ? null : (
                <section className="structured-plan">
                  <strong>{t('terminal.unified.plan-label')}</strong>
                  <ol>{turn.plan.map((item) => <li data-state={item.status} key={item.id}>{item.text}</li>)}</ol>
                </section>
              )}
              {turn.approvals.map((approval) => (
                <section className="structured-approval" key={approval.id}>
                  <strong>{approval.title}</strong>
                  <p>{approval.detail}</p>
                  {approval.decision === null ? (
                    <div className="catalog-actions">
                      {approval.choices.map((decision) => (
                        <button
                          className={decision === 'deny' ? 'secondary-button' : 'primary-button'}
                          data-lumora-command
                          key={decision}
                          onClick={() => void dispatch({
                            kind: 'approval.respond',
                            connectionId: runtime.connectionId,
                            approvalId: approval.id,
                            decision
                          }).catch(() => undefined)}
                          type="button"
                        >
                          {t(approvalKeys[decision])}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </section>
              ))}
              {turn.assistantText === '' ? null : (
                <section className="structured-message structured-message-assistant">
                  <strong>{t('terminal.unified.assistant-label', { provider: providerName })}</strong>
                  <p>{turn.assistantText}</p>
                </section>
              )}
            </article>
          ))}
        </div>
        {state.error === null && !actionError ? null : (
          <div className="catalog-operation-error" role="alert">
            {state.error?.message ?? t('terminal.unified.action-failed')}
          </div>
        )}
        {state.usage?.totalTokens === null || state.usage === null ? null : (
          <p className="structured-usage">
            {t('terminal.unified.usage-label', { total: state.usage.totalTokens })}
          </p>
        )}
      </div>

      <footer className="structured-composer">
        <textarea
          aria-label={t('terminal.unified.message-label', { provider: providerName })}
          disabled={runtime.state !== 'ready' || sending}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onCompositionEnd={onComposition}
          onCompositionStart={onComposition}
          onKeyDown={onComposerKeyDown}
          placeholder={t('terminal.unified.message-placeholder', { provider: providerName })}
          ref={composer}
          rows={3}
          value={draft}
        />
        <div className="catalog-actions">
          {runningTurn ? (
            <button
              className="secondary-button"
              data-lumora-command
              onClick={() => void dispatch({ kind: 'turn.cancel', connectionId: runtime.connectionId }).catch(() => undefined)}
              type="button"
            >
              {t('terminal.unified.cancel')}
            </button>
          ) : null}
          <button className="primary-button" data-lumora-command disabled={draft.trim() === '' || sending || runningTurn} onClick={submit} type="button">
            {t('terminal.unified.send')}
          </button>
        </div>
      </footer>
    </section>
  );
}
