import type { ReactNode } from 'react';

/**
 * The application's icon set. One file so every glyph shares a viewBox, a
 * stroke weight and a cap style: an icon drawn to different rules reads as a
 * different control even when it sits in the same row.
 */
function Glyph({ path }: { path: string }): ReactNode {
  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 20 20"
    >
      <path d={path} />
    </svg>
  );
}

/** Dismisses a dialog, or a warning. */
export function CrossIcon(): ReactNode {
  return <Glyph path="M6 6l8 8M14 6l-8 8" />;
}

/** Reads something again: a circular arrow with its head at the top right. */
export function RefreshIcon(): ReactNode {
  return (
    <Glyph path="M16.5 8.5A6.5 6.5 0 1 0 15 14M16.5 4v4.5H12" />
  );
}

/** Opens something for editing. */
export function EditIcon(): ReactNode {
  return (
    <Glyph path="M13.4 3.9a1.6 1.6 0 0 1 2.3 2.3L7.4 14.5l-3 .7.7-3z" />
  );
}

/** Removes something for good. */
export function TrashIcon(): ReactNode {
  return (
    <Glyph path="M4 6h12M8 6V4.5h4V6M6.5 6l.6 9.2a1 1 0 0 0 1 .8h3.8a1 1 0 0 0 1-.8L13.5 6M9 9v4M11 9v4" />
  );
}
