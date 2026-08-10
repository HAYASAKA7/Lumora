import {
  useMemo,
  useReducer,
  useState,
  type CSSProperties
} from 'react';

import type {
  ProviderId,
  SessionImportInspection,
  SessionImportPlan,
  SessionTransferArchiveSelection,
  SessionTransferResult,
  SessionWorkspaceMapping,
  WorkspaceSummary
} from '../../../shared/contracts';
import { isUsableTransferSupport } from '../../../shared/session-transfer';
import {
  INITIAL_IMPORT_FLOW_STATE,
  reduceImportFlow
} from './session-transfer-state';
import { OverflowTooltip } from '../ui/Tooltip';
import { SelectMenu } from '../ui/SelectMenu';

interface SessionTransferDialogProps {
  selection: SessionTransferArchiveSelection;
  workspaces: readonly WorkspaceSummary[];
  onClose(): void;
  onImported(result: SessionTransferResult): Promise<void> | void;
}

const DIALOG_STYLE = {
  '--transfer-dialog-size': 'medium'
} as CSSProperties;

function sessionCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'session' : 'sessions'}`;
}

function providerStatusLabel(
  support: SessionImportInspection['providers'][number]['support']
): string {
  switch (support) {
    case 'provider_not_installed':
      return 'Install provider first';
    case 'provider_disabled':
      return 'Provider is disabled';
    case 'provider_version_unsupported':
      return 'Update provider first';
    case 'route_unverified':
      return 'Import route is not verified';
    case 'experimental':
      return 'Experimental';
    case 'supported':
      return 'Ready';
  }
}

export function SessionTransferDialog({
  onClose,
  onImported,
  selection,
  workspaces
}: SessionTransferDialogProps) {
  const [flow, dispatch] = useReducer(
    reduceImportFlow,
    INITIAL_IMPORT_FLOW_STATE
  );
  const [password, setPassword] = useState('');
  const [inspection, setInspection] =
    useState<SessionImportInspection | null>(null);
  const [selectedProviders, setSelectedProviders] = useState<Set<ProviderId>>(
    () => new Set()
  );
  const [workspaceMappings, setWorkspaceMappings] = useState<
    Map<string, string | null>
  >(() => new Map());
  const [availableWorkspaces, setAvailableWorkspaces] = useState<
    WorkspaceSummary[]
  >(() => [...workspaces]);
  const [plan, setPlan] = useState<SessionImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedProviderList = useMemo(
    () => [...selectedProviders].sort(),
    [selectedProviders]
  );

  const inspectArchive = async () => {
    if (selection.encrypted && password.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const nextInspection = await window.lumora.inspectSessionImport({
        selectionToken: selection.selectionToken,
        ...(selection.encrypted ? { password } : {})
      });
      setInspection(nextInspection);
      setSelectedProviders(
        new Set(
          nextInspection.providers
            .filter((provider) => isUsableTransferSupport(provider.support))
            .map((provider) => provider.provider)
        )
      );
      setWorkspaceMappings(
        new Map(
          nextInspection.workspaces.map((workspace) => [
            workspace.sourceWorkspaceKey,
            workspace.confidence === 'high'
              ? workspace.suggestedWorkspaceId
              : null
          ])
        )
      );
      dispatch({ type: 'advance', step: 'providers' });
    } catch {
      setError('The archive could not be inspected. Check the file and password.');
    } finally {
      setPassword('');
      setBusy(false);
    }
  };

  const addWorkspace = async () => {
    setBusy(true);
    setError(null);
    try {
      const workspace = await window.lumora.chooseTransferWorkspace();
      if (
        workspace !== null &&
        !availableWorkspaces.some((candidate) => candidate.id === workspace.id)
      ) {
        setAvailableWorkspaces((current) => [...current, workspace]);
      }
    } catch {
      setError('The workspace could not be added.');
    } finally {
      setBusy(false);
    }
  };

  const reviewImport = async () => {
    if (inspection === null || selectedProviderList.length === 0) return;
    setBusy(true);
    setError(null);
    const mappings: SessionWorkspaceMapping[] = inspection.workspaces.map(
      (workspace) => {
        const destinationWorkspaceId = workspaceMappings.get(
          workspace.sourceWorkspaceKey
        );
        return destinationWorkspaceId
          ? {
              sourceWorkspaceKey: workspace.sourceWorkspaceKey,
              action: 'map',
              destinationWorkspaceId
            }
          : {
              sourceWorkspaceKey: workspace.sourceWorkspaceKey,
              action: 'skip'
            };
      }
    );
    try {
      const nextPlan = await window.lumora.planSessionImport({
        inspectionToken: inspection.inspectionToken,
        providers: selectedProviderList,
        workspaceMappings: mappings
      });
      setPlan(nextPlan);
      dispatch({ type: 'advance', step: 'review' });
    } catch {
      setError('Lumora could not prepare this import.');
    } finally {
      setBusy(false);
    }
  };

  const executeImport = async () => {
    if (plan === null || plan.ready.length === 0) return;
    setBusy(true);
    setError(null);
    dispatch({ type: 'begin_execution' });
    const unsubscribe = window.lumora.onTransferEvent((event) => {
      if (event.direction === 'import') {
        dispatch({ type: 'progress', event });
      }
    });
    try {
      const nextResult = await window.lumora.executeSessionImport({
        planToken: plan.planToken
      });
      if (nextResult.importedCount > 0) {
        await onImported(nextResult);
      }
      dispatch({ type: 'completed', result: nextResult });
    } catch {
      setError('The session import did not complete.');
      dispatch({ type: 'failed' });
    } finally {
      unsubscribe();
      setBusy(false);
    }
  };

  const cancelImport = async () => {
    if (flow.operationId === null) return;
    setBusy(true);
    try {
      await window.lumora.cancelTransferOperation(flow.operationId);
      dispatch({ type: 'cancelled', operationId: flow.operationId });
    } catch {
      setError('Lumora could not cancel this operation.');
    } finally {
      setBusy(false);
    }
  };

  const canClose = flow.step !== 'progress';
  const title =
    flow.step === 'unlock'
      ? 'Open session archive'
      : flow.step === 'providers'
        ? 'Choose providers'
        : flow.step === 'workspaces'
          ? 'Map workspaces'
          : flow.step === 'review'
            ? 'Review import'
            : flow.step === 'progress'
              ? 'Importing sessions'
              : flow.outcome === 'completed'
                ? 'Import complete'
                : flow.outcome === 'cancelled'
                  ? 'Import cancelled'
                  : 'Import incomplete';

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-labelledby="session-transfer-title"
        aria-modal="true"
        className="new-session-dialog session-transfer-dialog"
        role="dialog"
        style={DIALOG_STYLE}
      >
        <header>
          <div>
            <p className="card-label">Cross-device transfer</p>
            <h2 id="session-transfer-title">{title}</h2>
          </div>
          <button
            aria-label="Close session import"
            className="text-button"
            disabled={!canClose}
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </header>

        <div className="dialog-body session-transfer-dialog-body">
          {error !== null ? (
            <p className="catalog-operation-error" role="alert">
              {error}
            </p>
          ) : null}

          {flow.step === 'unlock' ? (
            <div className="transfer-workflow-stage">
              <p className="card-description">
                {selection.fileName}
                {selection.encrypted
                  ? ' is password protected.'
                  : ' is ready to inspect.'}
              </p>
              {selection.encrypted ? (
                <label className="transfer-field">
                  <span>Archive password</span>
                  <input
                    autoComplete="off"
                    disabled={busy}
                    onChange={(event) => setPassword(event.currentTarget.value)}
                    type="password"
                    value={password}
                  />
                </label>
              ) : null}
            </div>
          ) : null}

          {flow.step === 'providers' && inspection !== null ? (
            <div className="transfer-workflow-stage">
              <p className="card-description">
                Select the installed providers to import. Unsupported providers
                stay safely inside the archive.
              </p>
              <div className="transfer-option-list">
                {inspection.providers.map((provider) => {
                  const supported = isUsableTransferSupport(provider.support);
                  return (
                    <label
                      className="transfer-option-card"
                      key={provider.provider}
                    >
                      <input
                        checked={selectedProviders.has(provider.provider)}
                        disabled={!supported}
                        onChange={(event) => {
                          setSelectedProviders((current) => {
                            const next = new Set(current);
                            if (event.currentTarget.checked) {
                              next.add(provider.provider);
                            } else {
                              next.delete(provider.provider);
                            }
                            return next;
                          });
                        }}
                        type="checkbox"
                      />
                      <span>
                        <strong>
                          {provider.displayName} ·{' '}
                          {supported
                            ? `${provider.sessionCount} ready`
                            : providerStatusLabel(provider.support)}
                        </strong>
                        <small>
                          {supported
                            ? sessionCountLabel(provider.sessionCount)
                            : provider.installGuidance ??
                              providerStatusLabel(provider.support)}
                        </small>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}

          {flow.step === 'workspaces' && inspection !== null ? (
            <div className="transfer-workflow-stage">
              <div className="transfer-stage-heading">
                <p className="card-description">
                  Map each source workspace to an existing folder, or skip its
                  sessions.
                </p>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void addWorkspace()}
                  type="button"
                >
                  Add workspace
                </button>
              </div>
              <div className="transfer-workspace-list">
                {inspection.workspaces.map((source) => (
                  <div
                    className="transfer-field transfer-workspace-field"
                    key={source.sourceWorkspaceKey}
                  >
                    <span>
                      {source.displayName} · {sessionCountLabel(source.sessionCount)}
                    </span>
                    <OverflowTooltip content={source.originalPath}><small>{source.originalPath}</small></OverflowTooltip>
                    <SelectMenu
                      disabled={busy}
                      label={`${source.displayName} workspace destination`}
                      onChange={(value) => {
                        const destination = value || null;
                        setWorkspaceMappings((current) => {
                          const next = new Map(current);
                          next.set(source.sourceWorkspaceKey, destination);
                          return next;
                        });
                      }}
                      options={[
                        { value: '', label: 'Skip this workspace' },
                        ...availableWorkspaces.map((workspace) => ({
                          value: workspace.id,
                          label: `${workspace.displayName} — ${workspace.canonicalPath}`
                        }))
                      ]}
                      value={workspaceMappings.get(source.sourceWorkspaceKey) ?? ''}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {flow.step === 'review' && plan !== null ? (
            <div className="transfer-workflow-stage">
              <div className="transfer-summary-grid">
                <div>
                  <strong>{plan.ready.length}</strong>
                  <span>Ready to import</span>
                </div>
                <div>
                  <strong>{plan.skipped.length}</strong>
                  <span>Will be skipped</span>
                </div>
                <div>
                  <strong>{plan.providers.length}</strong>
                  <span>Providers</span>
                </div>
              </div>
              {plan.ready.length === 0 ? (
                <p className="transfer-guidance">
                  Nothing is ready to import. Go back and review provider and
                  workspace choices.
                </p>
              ) : null}
            </div>
          ) : null}

          {flow.step === 'progress' ? (
            <div className="transfer-workflow-stage transfer-progress">
              <div
                aria-label="Session import progress"
                aria-valuemax={flow.progress?.total ?? 1}
                aria-valuemin={0}
                aria-valuenow={flow.progress?.completed ?? 0}
                className="transfer-progress-track"
                role="progressbar"
              >
                <span
                  style={{
                    width: `${
                      flow.progress && flow.progress.total > 0
                        ? (flow.progress.completed / flow.progress.total) * 100
                        : 4
                    }%`
                  }}
                />
              </div>
              <p>
                {flow.progress?.message ??
                  'Preparing the selected sessions for import.'}
              </p>
            </div>
          ) : null}

          {flow.step === 'result' ? (
            <div className="transfer-workflow-stage">
              <div className="transfer-summary-grid">
                <div>
                  <strong>{flow.result?.importedCount ?? 0}</strong>
                  <span>Imported</span>
                </div>
                <div>
                  <strong>{flow.result?.skippedCount ?? 0}</strong>
                  <span>Skipped</span>
                </div>
                <div>
                  <strong>{flow.result?.failedCount ?? 0}</strong>
                  <span>Failed</span>
                </div>
              </div>
              <p className="transfer-guidance">
                {flow.outcome === 'completed'
                  ? 'Imported sessions are now available in Lumora.'
                  : flow.outcome === 'cancelled'
                    ? 'No additional sessions will be imported.'
                    : 'Review the archive and try again when ready.'}
              </p>
            </div>
          ) : null}
        </div>

        <footer>
          {flow.step === 'unlock' ? (
            <button
              className="refresh-button"
              disabled={busy || (selection.encrypted && password.length === 0)}
              onClick={() => void inspectArchive()}
              type="button"
            >
              {busy
                ? 'Inspecting archive'
                : selection.encrypted
                  ? 'Unlock archive'
                  : 'Review archive'}
            </button>
          ) : null}
          {flow.step === 'providers' ? (
            <>
              <button
                className="secondary-button"
                onClick={() => dispatch({ type: 'back' })}
                type="button"
              >
                Back
              </button>
              <button
                className="refresh-button"
                disabled={selectedProviderList.length === 0}
                onClick={() =>
                  dispatch({ type: 'advance', step: 'workspaces' })
                }
                type="button"
              >
                Continue
              </button>
            </>
          ) : null}
          {flow.step === 'workspaces' ? (
            <>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => dispatch({ type: 'back' })}
                type="button"
              >
                Back
              </button>
              <button
                className="refresh-button"
                disabled={busy}
                onClick={() => void reviewImport()}
                type="button"
              >
                {busy ? 'Preparing import' : 'Review import'}
              </button>
            </>
          ) : null}
          {flow.step === 'review' && plan !== null ? (
            <>
              <button
                className="secondary-button"
                onClick={() => dispatch({ type: 'back' })}
                type="button"
              >
                Back
              </button>
              <button
                className="refresh-button"
                disabled={plan.ready.length === 0 || busy}
                onClick={() => void executeImport()}
                type="button"
              >
                Import {sessionCountLabel(plan.ready.length)}
              </button>
            </>
          ) : null}
          {flow.step === 'progress' && flow.operationId !== null ? (
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => void cancelImport()}
              type="button"
            >
              Cancel import
            </button>
          ) : null}
          {flow.step === 'result' ? (
            <button className="refresh-button" onClick={onClose} type="button">
              Close
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}
