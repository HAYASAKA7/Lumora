import { useEffect, useMemo, useState } from 'react';

import type {
  ProviderId,
  SessionExportPlan,
  SessionTransferProgressEvent,
  SessionTransferResult
} from '../../../shared/contracts';
import { providerDefinition } from '../../../shared/provider-definitions';
import { useLocalization } from '../localization/useLocalization';

interface SessionExportDialogProps {
  sessionIds: readonly string[];
  onClose(): void;
}

type ExportStep = 'preparing' | 'review' | 'progress' | 'result';

export function SessionExportDialog({
  onClose,
  sessionIds
}: SessionExportDialogProps) {
  const { formatNumber, t } = useLocalization();
  const sessionCountLabel = (count: number) => t('transfer.export.session-count', { count });
  const byteLabel = (bytes: number): string => {
    if (bytes < 1_024) return `${formatNumber(bytes)} B`;
    if (bytes < 1_048_576) return `${formatNumber(bytes / 1_024, { maximumFractionDigits: 1 })} KB`;
    return `${formatNumber(bytes / 1_048_576, { maximumFractionDigits: 1 })} MB`;
  };
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
        setError(t('transfer.export.prepare-error'));
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
      setError(t('transfer.export.create-error'));
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
      setError(t('transfer.export.cancel-error'));
    } finally {
      setBusy(false);
    }
  };

  const title =
    step === 'preparing'
      ? t('transfer.export.preparing-title')
      : step === 'review'
        ? t('transfer.export.review-title')
        : step === 'progress'
          ? t('transfer.export.progress-title')
          : cancelled
            ? t('transfer.export.cancelled-title')
            : result?.status === 'completed'
              ? t('transfer.export.complete')
              : t('transfer.export.incomplete-title');

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
            <p className="card-label">{t('transfer.export.cross-device')}</p>
            <h2 id="session-export-title">{title}</h2>
          </div>
          <button
            aria-label={t('transfer.export.close-label')}
            className="text-button"
            disabled={step === 'progress'}
            onClick={onClose}
            type="button"
          >
            {t('common.actions.close')}
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
              {t('transfer.export.checking')}
            </div>
          ) : null}

          {step === 'review' && plan !== null ? (
            <div className="transfer-workflow-stage">
              <div className="transfer-summary-grid">
                <div>
                  <strong>{plan.sessions.length}</strong>
                  <span>
                    {t('transfer.export.ready-label')}
                  </span>
                </div>
                <div>
                  <strong>{plan.skipped.length}</strong>
                  <span>{t('transfer.export.excluded')}</span>
                </div>
                <div>
                  <strong>{byteLabel(plan.estimatedBytes)}</strong>
                  <span>{t('transfer.export.estimated-size')}</span>
                </div>
              </div>
              <p className="transfer-ready-summary">
                {t('transfer.export.ready-count', { count: plan.sessions.length })}
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
                    {t('transfer.export.excluded-count', { count: plan.skipped.length })}
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
                  aria-label={t('transfer.export.encrypt')}
                  checked={encrypted}
                  onChange={(event) => setEncrypted(event.currentTarget.checked)}
                  type="checkbox"
                />
                <span>
                  <strong>{t('transfer.export.encrypt')}</strong>
                  <small>{t('transfer.export.encrypt-description')}</small>
                </span>
              </label>
              {encrypted ? (
                <div className="transfer-password-grid">
                  <label className="transfer-field">
                    <span>{t('transfer.export.password')}</span>
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
                    <span>{t('transfer.export.confirm-password')}</span>
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
                  {t('transfer.export.unencrypted-warning')}
                </p>
              )}
            </div>
          ) : null}

          {step === 'progress' ? (
            <div className="transfer-workflow-stage transfer-progress">
              <div
                aria-label={t('transfer.export.progress-label')}
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
                  t('transfer.export.choose-native')}
              </p>
            </div>
          ) : null}

          {step === 'result' ? (
            <div className="transfer-workflow-stage">
              {result !== null ? (
                <div className="transfer-summary-grid">
                  <div>
                    <strong>{result.exportedCount}</strong>
                    <span>{t('transfer.export.exported')}</span>
                  </div>
                  <div>
                    <strong>{result.skippedCount}</strong>
                    <span>{t('transfer.export.skipped')}</span>
                  </div>
                  <div>
                    <strong>{result.failedCount}</strong>
                    <span>{t('transfer.export.failed')}</span>
                  </div>
                </div>
              ) : (
                <p className="transfer-guidance">
                  {cancelled
                    ? t('transfer.export.no-saved')
                    : t('transfer.export.no-created')}
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
              {t('transfer.export.choose-and-export')}
            </button>
          ) : null}
          {step === 'progress' && progress !== null ? (
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => void cancel()}
              type="button"
            >
              {t('transfer.export.cancel')}
            </button>
          ) : null}
          {step === 'result' ? (
            <button className="refresh-button" onClick={onClose} type="button">
              {t('common.actions.close')}
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}
