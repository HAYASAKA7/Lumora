import { useMemo, useState } from 'react';

import type {
  ProviderId,
  ProviderScanResult,
  SessionSummary,
  SessionTransferCapability
} from '../../../shared/contracts';
import { providerDefinition } from '../../../shared/provider-definitions';
import {
  ProgressiveListControl,
  useProgressiveList
} from '../catalog/progressive-list';
import { formatLifetimeTokens } from '../catalog/session-usage';
import { Tooltip } from '../ui/Tooltip';
import { SelectMenu } from '../ui/SelectMenu';
import { useSessionExportSelection } from './useSessionExportSelection';

const SESSION_BATCH_SIZE = 40;

interface SessionTransferExportSelectionProps {
  capabilities: readonly SessionTransferCapability[];
  providerScan: ProviderScanResult | null;
  runningSessionIds: ReadonlySet<string>;
  sessions: readonly SessionSummary[];
  onBack(): void;
  onContinue(sessionIds: readonly string[]): void;
}

export function SessionTransferExportSelection({
  capabilities,
  onBack,
  onContinue,
  providerScan,
  runningSessionIds,
  sessions
}: SessionTransferExportSelectionProps) {
  const [provider, setProvider] = useState<ProviderId | 'all'>('all');
  const selection = useSessionExportSelection({
    capabilities,
    providerScan,
    runningSessionIds,
    sessions
  });
  const providerIds = useMemo(
    () => [...new Set(sessions.map((session) => session.provider))].sort(),
    [sessions]
  );
  const visibleSessions = useMemo(
    () =>
      provider === 'all'
        ? sessions
        : sessions.filter((session) => session.provider === provider),
    [provider, sessions]
  );
  const progress = useProgressiveList({
    itemCount: visibleSessions.length,
    resetKey: provider,
    initialCount: SESSION_BATCH_SIZE,
    batchSize: SESSION_BATCH_SIZE
  });

  const back = () => {
    selection.clear();
    onBack();
  };

  const proceed = () => {
    if (selection.selected.size === 0) return;
    const sessionIds = [...selection.selected];
    selection.clear();
    onContinue(sessionIds);
  };

  return (
    <section
      aria-labelledby="transfer-export-selection-title"
      className="transfer-export-selection"
    >
      <header className="transfer-export-selection-header">
        <div>
          <p className="card-label">Session archive</p>
          <h2 id="transfer-export-selection-title">
            Choose sessions to export
          </h2>
          <p className="card-description">
            Only stopped sessions with a verified provider route can be
            selected.
          </p>
        </div>
        <div className="transfer-export-selection-actions">
          <button className="secondary-button" onClick={back} type="button">
            Back
          </button>
          <button
            className="refresh-button"
            disabled={selection.selected.size === 0}
            onClick={proceed}
            type="button"
          >
            Continue with {selection.selected.size}{' '}
            {selection.selected.size === 1 ? 'session' : 'sessions'}
          </button>
        </div>
      </header>

      <div className="transfer-export-selection-toolbar">
        <div className="select-field">
          <span>Provider</span>
          <SelectMenu
            label="Filter export sessions by provider"
            onChange={(value) => setProvider(value as ProviderId | 'all')}
            options={[
              { value: 'all', label: 'All providers' },
              ...providerIds.map((providerId) => ({
                value: providerId,
                label: providerDefinition(providerId).displayName
              }))
            ]}
            value={provider}
          />
        </div>
        <div className="session-export-provider-options">
          {providerIds.map((providerId) => {
            const eligible =
              selection.eligibleByProvider.get(providerId) ?? [];
            return (
              <label key={providerId}>
                <input
                  aria-label={`Select all ${providerDefinition(providerId).displayName} sessions`}
                  checked={
                    eligible.length > 0 &&
                    eligible.every((session) =>
                      selection.selected.has(session.id)
                    )
                  }
                  disabled={eligible.length === 0}
                  onChange={() => selection.toggleProvider(providerId)}
                  type="checkbox"
                />
                <span>{providerDefinition(providerId).displayName}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="transfer-export-selection-summary">
        <strong>{selection.selected.size} selected</strong>
        <span>{visibleSessions.length} sessions in this view</span>
      </div>

      {visibleSessions.length === 0 ? (
        <p className="transfer-empty">No sessions match this provider.</p>
      ) : (
        <>
          <div className="transfer-export-session-list">
            {visibleSessions
              .slice(0, progress.visibleCount)
              .map((session) => {
                const disabledReason = selection.disabledReason(session);
                return (
                  <Tooltip
                    content={disabledReason ?? 'Select this session'}
                    key={session.id}
                    multiline={disabledReason !== null}
                  >
                    <label
                      className={`transfer-export-session-row${
                        disabledReason === null
                          ? ''
                          : ' transfer-export-session-row-disabled'
                      }`}
                    >
                    <input
                      aria-label={session.title}
                      checked={selection.selected.has(session.id)}
                      disabled={disabledReason !== null}
                      onChange={() => selection.toggleSession(session)}
                      type="checkbox"
                    />
                    <span className="transfer-export-session-copy">
                      <strong>{session.title}</strong>
                      <span>
                        {providerDefinition(session.provider).displayName}
                        {session.lifetimeTokens === null
                          ? ''
                          : ` · ${formatLifetimeTokens(session.lifetimeTokens)}`}
                      </span>
                    </span>
                    <span className="transfer-export-session-state">
                      {disabledReason ?? 'Ready'}
                    </span>
                    </label>
                  </Tooltip>
                );
              })}
          </div>
          <ProgressiveListControl
            hasMore={progress.hasMore}
            label="Load more sessions"
            onLoadMore={progress.showMore}
          />
        </>
      )}
    </section>
  );
}
