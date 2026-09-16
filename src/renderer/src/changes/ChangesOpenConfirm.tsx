import type { ReactNode } from 'react';

import { useLocalization } from '../localization/useLocalization';
import { ConfirmDialog } from '../ui/ConfirmDialog';

interface ChangesOpenConfirmProps {
  path: string;
  /** Opens the file with whatever the system set up for its type. */
  onOpenAnyway(): void;
  onReveal(): void;
  onClose(): void;
}

/**
 * Asks before handing a script to the program set up for its type. Showing it
 * in its folder is the safe answer, so that is what the cancel button does;
 * Escape only closes the question.
 */
export function ChangesOpenConfirm({ onClose, onOpenAnyway, onReveal, path }: ChangesOpenConfirmProps): ReactNode {
  const { t } = useLocalization();
  return (
    <ConfirmDialog
      cancelLabel={t('terminal.changes.reveal-file')}
      confirmLabel={t('terminal.changes.open-confirm-action')}
      description={t('terminal.changes.open-confirm-body', { path })}
      heading={t('terminal.changes.open-confirm-title')}
      onCancel={onReveal}
      onConfirm={onOpenAnyway}
      onEscape={onClose}
    />
  );
}
