import { useEffect, useMemo, useState } from 'react';

import type {
  ProviderId,
  SessionExportPlan,
  SessionTransferProgressEvent,
  SessionTransferResult
} from '../../../shared/contracts';
import { providerDefinition } from '../../../shared/provider-definitions';

interface SessionExportDialogProps {
  sessionIds: readonly string[];
  onClose(): void;
}

type ExportStep = 'preparing' | 'review' | 'progress' | 'result';

function sessionCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'session' : 'sessions'}`;
}

function byteLabel(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export function SessionExportDialog({
  onClose,
  sessionIds
}: SessionExportDialogProps) {
  const [step, setStep] = useState<ExportStep>('preparing');
  const [plan, setPlan] = useState<SessionExportPlan | null>(null);
  const [encrypted, setEncrypted] = useState(true);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [progress, setProgress] =
    useState<SessionTransferProgressEvent | null>(null);
  const [result, setResult] = useState<SessionTransferResult | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    void window.lumora.prepareSessionExport({ sessionIds: [...sessionIds] }).then(
      (nextPlan) => {
        if (!current) return;
        setPlan(nextPlan);
        setStep('review');
      },
      () => {
        if (!current) return;
        setError('Lumora could not prepare the selected sessions.');
        setStep('result');
      }
    );
    return () => {
      current = false;
    };
  }, [sessionIds]);

  const providerCounts = useMemo(() => {
    const counts = new Map<ProviderId, number>();
    for (const session of plan?.sessions ?? []) {
      counts.set(session.provider, (counts.get(session.provider) ?? 0) + 1);
    }
    return [...counts.entries()];
  }, [plan]);

  const canExport =
    plan !== null &&
    plan.sessions.length > 0 &&
    (!encrypted ||
      (password.length > 0 &&
        password === confirmation &&
        password.length <= 1_024));

  const execute = async () => {
    if (plan === null || !canExport) return;
    const protection = encrypted
      ? ({ encrypted: true, password } as const)
      : ({ encrypted: false } as const);
    setStep('progress');
    setBusy(true);
    setError(null);
    setPassword('');
    setConfirmation('');
    const unsubscribe = window.lumora.onTransferEvent((event) => {
      if (event.direction === 'export') setProgress(event);
    });
    try {
      const nextResult = await window.lumora.executeSessionExport({
        planToken: plan.planToken,
        protection
      });
      if (nextResult === null) {
        setCancelled(true);
      } else {
        setResult(nextResult);
      }
      setStep('result');
    } catch {
      setError('The session archive could not be created.');
      setStep('result');
    } finally {
      unsubscribe();
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (progress === null) return;
    setBusy(true);
    try {
      await window.lumora.cancelTransferOperation(progress.operationId);
      setCancelled(true);
      setStep('result');
    } catch {
      setError('Lumora could not cancel this export.');
    } finally {
      setBusy(false);
    }
  };

  const title =
    step === 'preparing'
      ? 'Preparing export'
      : step === 'review'
        ? 'Review export'
        : step === 'progress'
          ? 'Creating session archive'
          : cancelled
            ? 'Export cancelled'
            : result?.status === 'completed'
              ? 'Export complete'
              : 'Export incomplete';

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-labelledby="session-export-title"
        aria-modal="true"
        className="new-session-dialog session-export-dialog"
        role="dialog"
      >
        <header>
          <div>
            <p className="card-label">Cross-device transfer</p>
            <h2 id="session-export-title">{title}</h2>
          </div>
          <button
            aria-label="Close session export"
            className="text-button"
            disabled={step === 'progress'}
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </header>

        <div className="dialog-body">
          {error !== null ? (
            <p className="catalog-operation-error" role="alert">
              {error}
            </p>
          ) : null}

          {step === 'preparing' ? (
            <div className="transfer-panel-loading" role="status">
              Checking selected sessions
            </div>
          ) : null}

          {step === 'review' && plan !== null ? (
            <div className="transfer-workflow-stage">
              <div className="transfer-summary-grid">
                <div>
                  <strong>{plan.sessions.length}</strong>
                  <span>
                    {plan.sessions.length === 1
                      ? 'Ready to export'
                      : 'Ready to export'}
                  </span>
                </div>
                <div>
                  <strong>{plan.skipped.length}</strong>
                  <span>Excluded</span>
                </div>
                <div>
                  <strong>{byteLabel(plan.estimatedBytes)}</strong>
                  <span>Estimated size</span>
                </div>
              </div>
              <p className="transfer-ready-summary">
                {plan.sessions.length} ready to export
              </p>
              <div className="transfer-provider-counts">
                {providerCounts.map(([provider, count]) => (
                  <span key={provider}>
                    {providerDefinition(
                      provider as Parameters<typeof providerDefinition>[0]
                    ).displayName}{' '}
                    · {sessionCountLabel(count)}
                  </span>
                ))}
              </div>
              {plan.skipped.length > 0 ? (
                <details className="transfer-skipped-details">
                  <summary>
                    {sessionCountLabel(plan.skipped.length)} excluded
                  </summary>
                  <ul>
                    {plan.skipped.map((session) => (
                      <li key={session.sessionId}>{session.message}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <label className="transfer-encryption-toggle">
                <input
                  aria-label="Encrypt archive"
                  checked={encrypted}
                  onChange={(event) => setEncrypted(event.currentTarget.checked)}
                  type="checkbox"
                />
                <span>
                  <strong>Encrypt archive</strong>
                  <small>Recommended for session files and transcripts.</small>
                </span>
              </label>
              {encrypted ? (
                <div className="transfer-password-grid">
                  <label className="transfer-field">
                    <span>Archive password</span>
                    <input
                      autoComplete="new-password"
                      maxLength={1_024}
                      onChange={(event) =>
                        setPassword(event.currentTarget.value)
                      }
                      type="password"
                      value={password}
                    />
                  </label>
                  <label className="transfer-field">
                    <span>Confirm password</span>
                    <input
                      autoComplete="new-password"
                      maxLength={1_024}
                      onChange={(event) =>
                        setConfirmation(event.currentTarget.value)
                      }
                      type="password"
                      value={confirmation}
                    />
                  </label>
                </div>
              ) : (
                <p className="transfer-unencrypted-warning" role="alert">
                  Anyone with this archive can read its session files.
                </p>
              )}
            </div>
          ) : null}

          {step === 'progress' ? (
            <div className="transfer-workflow-stage transfer-progress">
              <div
                aria-label="Session export progress"
                aria-valuemax={progress?.total ?? 1}
                aria-valuemin={0}
                aria-valuenow={progress?.completed ?? 0}
                className="transfer-progress-track"
                role="progressbar"
              >
                <span
                  style={{
                    width: `${
                      progress && progress.total > 0
                        ? (progress.completed / progress.total) * 100
                        : 4
                    }%`
                  }}
                />
              </div>
              <p>
                {progress?.message ??
                  'Choose where to save the archive in the native dialog.'}
              </p>
            </div>
          ) : null}

          {step === 'result' ? (
            <div className="transfer-workflow-stage">
              {result !== null ? (
                <div className="transfer-summary-grid">
                  <div>
                    <strong>{result.exportedCount}</strong>
                    <span>Exported</span>
                  </div>
                  <div>
                    <strong>{result.skippedCount}</strong>
                    <span>Skipped</span>
                  </div>
                  <div>
                    <strong>{result.failedCount}</strong>
                    <span>Failed</span>
                  </div>
                </div>
              ) : (
                <p className="transfer-guidance">
                  {cancelled
                    ? 'No archive was saved.'
                    : 'No session archive was created.'}
                </p>
              )}
            </div>
          ) : null}
        </div>

        <footer>
          {step === 'review' ? (
            <button
              className="refresh-button"
              disabled={!canExport || busy}
              onClick={() => void execute()}
              type="button"
            >
              Choose destination and export
            </button>
          ) : null}
          {step === 'progress' && progress !== null ? (
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => void cancel()}
              type="button"
            >
              Cancel export
            </button>
          ) : null}
          {step === 'result' ? (
            <button className="refresh-button" onClick={onClose} type="button">
              Close
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}
