import type { ReactNode } from 'react';

import { LoadingIcon } from './icons';
import { Tooltip } from './Tooltip';

/**
 * A button that shows only its icon. The name it would have carried moves into
 * the tooltip and the accessible name, so a row of repeated actions stays
 * short without becoming unreadable to anyone who cannot see the glyph.
 *
 * Use it for utility actions in a header or a row. An action that concludes a
 * flow, or that sits among worded choices, keeps its word.
 */
export function IconButton({
  busy = false,
  busyLabel,
  children,
  className = '',
  disabled = false,
  label,
  onClick,
  shortcut,
  tabIndex,
  tone = 'normal'
}: {
  /**
   * Replaces the icon with the loading mark and announces the work through
   * `aria-busy`. The name is deliberately left alone: it identifies the
   * control, and a name that changes mid-action makes the button hard to find
   * again.
   */
  busy?: boolean;
  /**
   * What the tooltip says while the button works, such as "Updating
   * Codex". Only the tooltip changes: the accessible name stays the name of
   * the action, and `aria-busy` carries the state.
   */
  busyLabel?: string | undefined;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  /** What the button does, for the tooltip and assistive technology. */
  label: string;
  onClick(): void;
  /** The written shortcut that does the same thing, shown under the name. */
  shortcut?: string | undefined;
  tabIndex?: number | undefined;
  tone?: 'normal' | 'danger' | 'primary';
}): ReactNode {
  const classes = [
    'icon-button',
    tone === 'danger' ? 'icon-button-danger' : '',
    tone === 'primary' ? 'icon-button-primary' : '',
    busy ? 'icon-button-busy' : '',
    className
  ].filter((entry) => entry !== '').join(' ');

  return (
    <Tooltip content={busy && busyLabel !== undefined ? busyLabel : label} shortcut={shortcut}>
      <button
        aria-busy={busy}
        aria-label={label}
        className={classes}
        data-lumora-command
        disabled={disabled}
        onClick={onClick}
        {...(tabIndex === undefined ? {} : { tabIndex })}
        type="button"
      >
        {busy ? <LoadingIcon /> : children}
      </button>
    </Tooltip>
  );
}
