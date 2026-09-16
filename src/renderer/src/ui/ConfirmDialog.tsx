import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { useEscapeLayer } from './escape-layers';
import { useLocalization } from '../localization/useLocalization';

interface ConfirmDialogProps {
  acknowledgement?: {
    checked: boolean;
    label: string;
    onChange(checked: boolean): void;
  };
  cancelLabel?: string;
  confirmDisabled?: boolean;
  confirmLabel: string;
  description: ReactNode;
  heading: string;
  onCancel(): void;
  /** Escape when the cancel button does more than close, such as revealing a file. */
  onEscape?(): void;
  onConfirm(): void;
  suppression?: {
    checked: boolean;
    label: string;
    onChange(checked: boolean): void;
  };
}

export function ConfirmDialog({
  acknowledgement,
  cancelLabel,
  confirmDisabled = false,
  confirmLabel,
  description,
  heading,
  onCancel,
  onConfirm,
  onEscape,
  suppression
}: ConfirmDialogProps): ReactNode {
  const { t } = useLocalization();
  const resolvedCancelLabel = cancelLabel ?? t('common.actions.cancel');
  const titleId = useId();
  const suppressionLabelId = useId();
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  // Escape only closes when the cancel button acts; otherwise the two are the same.
  useEscapeLayer(onEscape ?? onCancel);

  return createPortal(
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="new-session-dialog confirm-dialog"
        role="dialog"
      >
        <header>
          <div>
            <p className="card-label">{t('common.labels.confirmation')}</p>
            <h2 id={titleId}>{heading}</h2>
          </div>
        </header>
        <div className="dialog-body">
          <p className="card-description confirm-dialog-description">{description}</p>
          {acknowledgement === undefined ? null : (
            <label className="confirm-dialog-suppression">
              <input
                checked={acknowledgement.checked}
                onChange={(event) => acknowledgement.onChange(
                  event.currentTarget.checked
                )}
                type="checkbox"
              />
              <span>{acknowledgement.label}</span>
            </label>
          )}
          {suppression === undefined ? null : (
            <div className="confirm-dialog-suppression">
              <input
                aria-labelledby={suppressionLabelId}
                checked={suppression.checked}
                onChange={(event) => suppression.onChange(event.currentTarget.checked)}
                type="checkbox"
              />
              <span id={suppressionLabelId}>{suppression.label}</span>
            </div>
          )}
        </div>
        <footer className="modal-actions">
          <button
            className="secondary-button"
            onClick={onCancel}
            ref={cancelRef}
            type="button"
          >
            {resolvedCancelLabel}
          </button>
          <button
            className="refresh-button"
            disabled={confirmDisabled}
            onClick={onConfirm}
            type="button"
          >
            {confirmLabel}
          </button>
        </footer>
      </section>
    </div>,
    document.querySelector('.app-shell') ?? document.body
  );
}
