import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { useEscapeLayer } from '../ui/escape-layers';

import { useLocalization } from '../localization/useLocalization';
import { CloseButton } from '../ui/CloseButton';

/**
 * The window Diagnostics opens for detail. It keeps one fixed size, so figures
 * that change or a list that grows never resize it; its body scrolls instead.
 */
export function DiagnosticsDialog({ children, heading, onClose }: {
  children: ReactNode;
  heading: string;
  onClose(): void;
}): ReactNode {
  const { t } = useLocalization();
  const titleId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);
  useEscapeLayer(onClose);

  return createPortal(
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="new-session-dialog diagnostics-details-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <div>
            <p className="card-label">{t('settings.diagnostics.title')}</p>
            <h2 id={titleId}>{heading}</h2>
          </div>
          <CloseButton onClose={onClose} />
        </header>
        <div className="dialog-body">{children}</div>
      </section>
    </div>,
    document.querySelector('.app-shell') ?? document.body
  );
}
