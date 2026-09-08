import type { ReactNode } from 'react';

/**
 * The one cross in the application. Dismissing a dialog and dismissing a
 * warning are different actions, but they should not be drawn differently: a
 * typed × character takes its weight and metrics from whichever font is
 * loaded, so it never matched the stroked icons beside it.
 */
export function CrossIcon(): ReactNode {
  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="1.7"
      viewBox="0 0 20 20"
    >
      <path d="M6 6l8 8M14 6l-8 8" />
    </svg>
  );
}
