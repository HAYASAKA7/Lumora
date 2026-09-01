import {
  lazy,
  Suspense,
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
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { SelectMenu } from '../ui/SelectMenu';
import { useLocalization } from '../localization/useLocalization';
import {
  createStructuredAgentViewState,
  reduceStructuredAgentEvent,
  type StructuredAgentViewState
} from './structured-agent-state';
import { nextStructuredHistoryVisibleCount } from './structured-history-window';
import { StructuredDiff } from './StructuredDiff';
import { StructuredSessionDetailsDialog } from './StructuredSessionDetailsDialog';

interface StructuredAgentWorkspaceProps {
  api?: LumoraApi;
  activeConnectionId: string;
  focusRequestKey?: number;
  snapshots: readonly StructuredAgentRuntimeSnapshot[];
  showTabBar?: boolean;
  onActivate(connectionId: string): void;
  onClose(connectionId: string): void;
  onReconnect(connectionId: string): void;
}

const approvalKeys: Record<StructuredAgentApprovalDecision, string> = {
  allow_once: 'terminal.unified.allow-once',
  allow_session: 'terminal.unified.allow-session',
  deny: 'terminal.unified.deny'
};

const AgentMarkdown = lazy(async () => {
  const module = await import('./AgentMarkdown');
  return { default: module.AgentMarkdown };
});

const maximumCachedTurnCount = 200;
const earlierTurnLoadThreshold = 48;

function reduceSnapshotIntoCache(
  cached: StructuredAgentViewState,
  snapshot: StructuredAgentRuntimeSnapshot
): StructuredAgentViewState {
  let firstNewEvent = snapshot.events.length;
  while (firstNewEvent > 0) {
    const candidate = snapshot.events[firstNewEvent - 1]!;
    if (
      candidate.generation < cached.generation ||
      (candidate.generation === cached.generation &&
        candidate.sequence <= cached.sequence)
    ) break;
    firstNewEvent -= 1;
  }
  const next = snapshot.events
    .slice(firstNewEvent)
    .reduce(reduceStructuredAgentEvent, cached);
  if (next.turns.length <= maximumCachedTurnCount) return next;
  return {
    ...next,
    turns: next.turns.slice(-maximumCachedTurnCount)
  };
}

export function StructuredAgentWorkspace({
  api = window.lumora,
  activeConnectionId,
  focusRequestKey = 0,
  snapshots,
  showTabBar = true,
  onActivate,
  onClose,
  onReconnect
}: StructuredAgentWorkspaceProps): ReactNode {
  const { t } = useLocalization();
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [visibleTurnCounts, setVisibleTurnCounts] = useState<Readonly<Record<string, number>>>({});
  const [sending, setSending] = useState(false);
  const [modelSelections, setModelSelections] = useState<Readonly<Record<string, string>>>({});
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [actionError, setActionError] = useState(false);
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsRefreshFailed, setDetailsRefreshFailed] = useState(false);
  const viewStateCache = useRef(new Map<string, StructuredAgentViewState>());
  const composing = useRef(false);
  const composer = useRef<HTMLTextAreaElement | null>(null);
  const conversationScroller = useRef<HTMLDivElement | null>(null);
  const historyScrollRestore = useRef<{
    connectionId: string;
    scrollHeight: number;
    scrollTop: number;
  } | null>(null);
  const followLatest = useRef(true);
  const followedConnection = useRef<string | null>(null);
  const restoreComposerFocus = useRef(false);
  const snapshot = snapshots.find(
    (candidate) => candidate.runtime.connectionId === activeConnectionId
  ) ?? snapshots[0];
  const snapshotCommands = snapshot?.commands ?? [];
  const advertisedModelCommand = snapshotCommands.find(({ name, choices, selectedValue }) => (
    name.toLocaleLowerCase() === '/model' &&
    (choices?.length ?? 0) > 0 &&
    selectedValue !== undefined
  ));
  const state = useMemo(() => {
    if (snapshot === undefined) return createStructuredAgentViewState();
    const connectionId = snapshot.runtime.connectionId;
    const next = reduceSnapshotIntoCache(
      viewStateCache.current.get(connectionId) ?? createStructuredAgentViewState(),
      snapshot
    );
    viewStateCache.current.set(connectionId, next);
    return next;
  }, [snapshot]);
  const runtime = snapshot?.runtime;
  const visibleTurnCount = runtime === undefined
    ? 0
    : visibleTurnCounts[runtime.connectionId] ??
      nextStructuredHistoryVisibleCount(state.turns, 0);
  useEffect(() => {
    const activeConnectionIds = new Set(
      snapshots.map((candidate) => candidate.runtime.connectionId)
    );
    for (const connectionId of viewStateCache.current.keys()) {
      if (!activeConnectionIds.has(connectionId)) {
        viewStateCache.current.delete(connectionId);
      }
    }
    setVisibleTurnCounts((current) => {
      const staleConnectionIds = Object.keys(current).filter(
        (connectionId) => !activeConnectionIds.has(connectionId)
      );
      if (staleConnectionIds.length === 0) return current;
      return Object.fromEntries(
        Object.entries(current).filter(([connectionId]) => activeConnectionIds.has(connectionId))
      );
    });
  }, [snapshots]);
  useEffect(() => {
    const connectionId = snapshot?.runtime.connectionId;
    const selectedValue = advertisedModelCommand?.selectedValue;
    if (connectionId === undefined || selectedValue === undefined) return;
    setModelSelections((current) => current[connectionId] === selectedValue
      ? current
      : { ...current, [connectionId]: selectedValue });
  }, [advertisedModelCommand?.selectedValue, snapshot?.runtime.connectionId]);
  useEffect(() => {
    if (runtime?.state === 'ready') composer.current?.focus();
  }, [focusRequestKey, runtime?.connectionId, runtime?.state]);
  useEffect(() => {
    if (sending || !restoreComposerFocus.current) return;
    restoreComposerFocus.current = false;
    composer.current?.focus();
  }, [sending]);
  useLayoutEffect(() => {
    const scroller = conversationScroller.current;
    if (scroller === null || runtime === undefined) return;
    if (followedConnection.current !== runtime.connectionId) {
      followedConnection.current = runtime.connectionId;
      followLatest.current = true;
    }
    if (followLatest.current) scroller.scrollTop = scroller.scrollHeight;
  }, [runtime?.connectionId, state.generation, state.sequence]);
  useLayoutEffect(() => {
    const restore = historyScrollRestore.current;
    if (restore === null) return;
    historyScrollRestore.current = null;
    const scroller = conversationScroller.current;
    if (scroller === null || restore.connectionId !== runtime?.connectionId) return;
    scroller.scrollTop = restore.scrollTop + Math.max(
      0,
      scroller.scrollHeight - restore.scrollHeight
    );
  }, [runtime?.connectionId, visibleTurnCounts]);
  if (snapshot === undefined || runtime === undefined) return null;

  const draft = drafts[runtime.connectionId] ?? '';
  const setDraft = (value: string) => setDrafts((current) => ({
    ...current,
    [runtime.connectionId]: value
  }));
  const providerName = providerDefinition(runtime.providerId).displayName;
  const commands = snapshotCommands;
  const modelCommand = advertisedModelCommand;
  const selectedModel = modelCommand === undefined
    ? undefined
    : modelSelections[runtime.connectionId] ?? modelCommand.selectedValue;
  const commandQuery = /^\/[^\s]*$/.test(draft) ? draft.toLocaleLowerCase() : null;
  const filteredCommands = commandQuery === null
    ? []
    : commands.filter(({ name }) => name.toLocaleLowerCase().startsWith(commandQuery));
  const choiceMatch = /^(\/[^\s]+)\s+([^\s]*)$/.exec(draft);
  const choiceCommand = choiceMatch === null
    ? undefined
    : commands.find(({ name }) => (
      name.toLocaleLowerCase() === choiceMatch[1]!.toLocaleLowerCase()
    ));
  const choiceQuery = choiceMatch?.[2]?.toLocaleLowerCase() ?? '';
  const filteredChoices = (choiceCommand?.choices ?? []).filter((choice) => (
    choice.label.toLocaleLowerCase().includes(choiceQuery) ||
    choice.value.toLocaleLowerCase().includes(choiceQuery)
  ));
  const commandListOpen = filteredCommands.length > 0 || filteredChoices.length > 0;
  const commandOptionCount = filteredChoices.length > 0
    ? filteredChoices.length
    : filteredCommands.length;
  const runningTurn = state.turns.at(-1)?.status === 'running';
  const hiddenTurnCount = Math.max(0, state.turns.length - visibleTurnCount);
  const visibleTurns = hiddenTurnCount === 0
    ? state.turns
    : state.turns.slice(-visibleTurnCount);
  const latestTurnId = state.turns.at(-1)?.id;
  const revealEarlierTurns = (scroller: HTMLDivElement) => {
    if (
      hiddenTurnCount === 0 ||
      scroller.scrollTop > earlierTurnLoadThreshold ||
      historyScrollRestore.current !== null
    ) return;
    historyScrollRestore.current = {
      connectionId: runtime.connectionId,
      scrollHeight: scroller.scrollHeight,
      scrollTop: scroller.scrollTop
    };
    setVisibleTurnCounts((current) => ({
      ...current,
      [runtime.connectionId]: nextStructuredHistoryVisibleCount(
        state.turns,
        visibleTurnCount
      )
    }));
  };
  const dispatch = async (action: Parameters<LumoraApi['dispatchStructuredAgentAction']>[0]) => {
    setActionError(false);
    try {
      await api.dispatchStructuredAgentAction(action);
    } catch (error) {
      setActionError(true);
      throw error;
    }
  };
  const executeCommand = (commandId: string, argument: string) => {
    restoreComposerFocus.current = true;
    setSending(true);
    if (commandId === 'copy') {
      let assistantText = '';
      for (let index = state.turns.length - 1; index >= 0; index -= 1) {
        const candidate = state.turns[index]?.assistantText.trim() ?? '';
        if (candidate !== '') {
          assistantText = candidate;
          break;
        }
      }
      if (assistantText === '') {
        setActionError(true);
        setSending(false);
        return;
      }
      setActionError(false);
      void api.writeClipboardText(assistantText).then(
        () => setDraft(''),
        () => setActionError(true)
      ).finally(() => setSending(false));
      return;
    }
    void dispatch({
      kind: 'command.execute',
      connectionId: runtime.connectionId,
      commandId,
      argument
    }).then(
      () => {
        if (commandId === modelCommand?.id) {
          setModelSelections((current) => ({
            ...current,
            [runtime.connectionId]: argument
          }));
        }
        setDraft('');
      },
      () => undefined
    ).finally(() => setSending(false));
  };
  const selectModel = (value: string) => {
    if (
      modelCommand === undefined || value === selectedModel || sending ||
      runningTurn || runtime.state !== 'ready'
    ) return;
    restoreComposerFocus.current = true;
    setSending(true);
    void dispatch({
      kind: 'command.execute',
      connectionId: runtime.connectionId,
      commandId: modelCommand.id,
      argument: value
    }).then(
      () => setModelSelections((current) => ({
        ...current,
        [runtime.connectionId]: value
      })),
      () => undefined
    ).finally(() => {
      setSending(false);
      requestAnimationFrame(() => composer.current?.focus());
    });
  };
  const chooseCommand = (index: number) => {
    const command = filteredCommands[index];
    if (command === undefined) return;
    if ((command.choices?.length ?? 0) > 0 || command.inputHint !== null) {
      setDraft(`${command.name} `);
      setSelectedCommandIndex(0);
      requestAnimationFrame(() => composer.current?.focus());
      return;
    }
    executeCommand(command.id, '');
  };
  const chooseChoice = (index: number) => {
    const choice = filteredChoices[index];
    if (choiceCommand === undefined || choice === undefined) return;
    if (choiceCommand.selectionBehavior === 'continue') {
      setDraft(`${choiceCommand.name} ${choice.value} `);
      setSelectedCommandIndex(0);
      requestAnimationFrame(() => composer.current?.focus());
      return;
    }
    executeCommand(choiceCommand.id, choice.value);
  };
  const chooseActiveOption = (index: number) => {
    if (filteredChoices.length > 0) chooseChoice(index);
    else chooseCommand(index);
  };
  const submit = () => {
    const text = draft.trim();
    if (
      text === '' ||
      sending ||
      runningTurn ||
      runtime.state !== 'ready'
    ) return;
    const commandMatch = /^(\/[^\s]+)(?:\s+([\s\S]*))?$/.exec(text);
    const command = commandMatch === null
      ? undefined
      : commands.find(({ name }) => name.toLocaleLowerCase() === commandMatch[1]!.toLocaleLowerCase());
    if (command !== undefined) {
      const argument = commandMatch?.[2]?.trim() ?? '';
      if (argument === '' && (command.choices?.length ?? 0) > 0) {
        setDraft(`${command.name} `);
        setSelectedCommandIndex(0);
        return;
      }
      executeCommand(command.id, argument);
      return;
    }
    restoreComposerFocus.current = true;
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
    if (commandListOpen && !composing.current && !event.nativeEvent.isComposing) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedCommandIndex((current) => (current + 1) % commandOptionCount);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedCommandIndex((current) => (
          current - 1 + commandOptionCount
        ) % commandOptionCount);
        return;
      }
      if (event.key === 'Tab' || event.key === 'Enter') {
        event.preventDefault();
        chooseActiveOption(Math.min(selectedCommandIndex, commandOptionCount - 1));
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setDraft('');
        return;
      }
    }
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
  const openDetails = () => {
    setDetailsOpen(true);
    setDetailsLoading(true);
    setDetailsRefreshFailed(false);
    void api.dispatchStructuredAgentAction({
      kind: 'session.details.refresh',
      connectionId: runtime.connectionId
    }).catch(() => setDetailsRefreshFailed(true))
      .finally(() => setDetailsLoading(false));
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
          <button
            className="secondary-button"
            data-lumora-command
            onClick={openDetails}
            type="button"
          >
            {t('terminal.unified.details.title')}
          </button>
          {runtime.state === 'failed' ? (
            <button className="secondary-button" data-lumora-command onClick={() => onReconnect(runtime.connectionId)} type="button">
              {t('terminal.unified.reconnect')}
            </button>
          ) : null}
          <button className="secondary-button" data-lumora-command onClick={() => onClose(runtime.connectionId)} type="button">
            {t('terminal.unified.close')}
          </button>
        </div>
      </header>

      <div
        className="structured-agent-body"
        onScroll={(event) => {
          const scroller = event.currentTarget;
          const distanceFromBottom = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
          followLatest.current = distanceFromBottom <= 32;
          revealEarlierTurns(scroller);
        }}
        ref={conversationScroller}
      >
        {snapshot.boundary === null ? null : (
          <p className="structured-history-boundary">
            {t('terminal.unified.history-boundary')}
          </p>
        )}
        <div className="structured-conversation" aria-live="polite">
          {visibleTurns.map((turn) => (
            <article className="structured-turn" key={turn.id}>
              {turn.userText === '' ? null : (
                <section className="structured-message structured-message-user">
                  <p>{turn.userText}</p>
                </section>
              )}
              {turn.reasoning.length === 0 &&
              turn.activities.length === 0 &&
              turn.diffs.length === 0 &&
              turn.plan.length === 0 ? null : (
                <details className="structured-process">
                  <summary>{t('terminal.unified.process-label')}</summary>
                  <div className="structured-process-content">
                    {turn.reasoning.map((reasoning, index) => (
                      <section className="structured-reasoning" key={`${turn.id}-reasoning-${index}`}>
                        <strong>{t('terminal.unified.reasoning-label')}</strong>
                        <p>{reasoning}</p>
                      </section>
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
                    {turn.diffs.map((diff) => (
                      <StructuredDiff
                        diff={diff}
                        key={diff.id}
                        label={t('terminal.unified.activity-file')}
                      />
                    ))}
                    {turn.plan.length === 0 ? null : (
                      <section className="structured-plan">
                        <strong>{t('terminal.unified.plan-label')}</strong>
                        <ol>{turn.plan.map((item) => <li data-state={item.status} key={item.id}>{item.text}</li>)}</ol>
                      </section>
                    )}
                  </div>
                </details>
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
              {turn.assistantText === '' && turn.status !== 'running' ? null : (
                <section className="structured-message structured-message-assistant">
                  <div className="structured-assistant-title">
                    <strong>{t('terminal.unified.assistant-label', { provider: providerName })}</strong>
                    {turn.id !== latestTurnId ? null : (
                      <span
                        aria-live="polite"
                        className={`runtime-state runtime-${turn.status}`}
                      >
                        {t(turn.status === 'running'
                          ? 'common.states.running'
                          : turn.status === 'completed'
                            ? 'common.states.complete'
                            : turn.status === 'failed'
                              ? 'common.states.failed'
                              : turn.status === 'cancelled'
                                ? 'common.states.stopped'
                                : 'common.states.ready')}
                      </span>
                    )}
                  </div>
                  {turn.assistantText === '' ? null : (
                    <Suspense
                      fallback={(
                        <div className="structured-markdown structured-markdown-loading">
                          <p>{turn.assistantText}</p>
                        </div>
                      )}
                    >
                      <AgentMarkdown onOpenLink={setPendingLink}>
                        {turn.assistantText}
                      </AgentMarkdown>
                    </Suspense>
                  )}
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
      </div>

      <footer className="structured-composer">
        <div className="structured-composer-surface">
          {commandListOpen ? (
            <div
              aria-label={t('common.labels.command')}
              className="structured-command-list"
              role="listbox"
            >
              {(filteredChoices.length > 0 ? filteredChoices : filteredCommands).map((option, index) => (
                <button
                  aria-selected={index === selectedCommandIndex}
                  className="structured-command-option"
                  data-lumora-command
                  key={'id' in option ? option.id : option.value}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseActiveOption(index)}
                  role="option"
                  type="button"
                >
                  {'id' in option ? (
                    <>
                      <span>
                        <strong>{option.name}</strong>
                        {option.inputHint === null ? null : <code>{option.inputHint}</code>}
                      </span>
                      <small>{option.descriptionKey === undefined
                        ? option.description
                        : t(option.descriptionKey)}</small>
                    </>
                  ) : (
                    <>
                      <span><strong>{option.labelKey === undefined
                        ? option.label
                        : t(option.labelKey)}</strong></span>
                      {option.description === null ? null : <small>{option.description}</small>}
                    </>
                  )}
                </button>
              ))}
            </div>
          ) : null}
          <textarea
            aria-label={t('terminal.unified.message-label', { provider: providerName })}
            disabled={runtime.state !== 'ready' || sending}
            onChange={(event) => {
              setDraft(event.currentTarget.value);
              setSelectedCommandIndex(0);
            }}
            onCompositionEnd={onComposition}
            onCompositionStart={onComposition}
            onKeyDown={onComposerKeyDown}
            placeholder={t('terminal.unified.message-placeholder', { provider: providerName })}
            ref={composer}
            rows={3}
            value={draft}
          />
          <div className="structured-composer-actions">
            {modelCommand === undefined || selectedModel === undefined ? null : (
              <SelectMenu
                className="structured-model-select"
                disabled={sending || runningTurn || runtime.state !== 'ready'}
                label={t('terminal.unified.model-selector-label')}
                onChange={selectModel}
                options={modelCommand.choices!.map((choice) => ({
                  value: choice.value,
                  label: choice.labelKey === undefined ? choice.label : t(choice.labelKey)
                }))}
                value={selectedModel}
              />
            )}
            {runningTurn ? (
              <button
                aria-label={t('terminal.unified.cancel')}
                className="structured-composer-action structured-composer-action-stop"
                data-lumora-command
                onClick={() => void dispatch({ kind: 'turn.cancel', connectionId: runtime.connectionId }).catch(() => undefined)}
                type="button"
              >
                <span aria-hidden="true" className="structured-stop-icon" />
              </button>
            ) : (
              <button
                aria-label={t('terminal.unified.send')}
                className="structured-composer-action structured-composer-action-send"
                data-lumora-command
                disabled={draft.trim() === '' || sending}
                onClick={submit}
                type="button"
              >
                <svg aria-hidden="true" viewBox="0 0 20 20">
                  <path d="M10 15V5m0 0L6 9m4-4 4 4" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </footer>
      {pendingLink === null ? null : (
        <ConfirmDialog
          confirmLabel={t('terminal.runtime.open-link')}
          description={pendingLink}
          heading={t('terminal.runtime.open-link-title')}
          onCancel={() => setPendingLink(null)}
          onConfirm={() => {
            const url = pendingLink;
            setPendingLink(null);
            setActionError(false);
            void api.openTerminalLink(url).catch(() => setActionError(true));
          }}
        />
      )}
      {detailsOpen ? (
        <StructuredSessionDetailsDialog
          accountLoading={detailsLoading}
          accountRefreshFailed={detailsRefreshFailed}
          accountUsage={state.accountUsage}
          onClose={() => setDetailsOpen(false)}
          providerName={providerName}
          runtime={runtime}
          usage={state.usage}
        />
      ) : null}
    </section>
  );
}
