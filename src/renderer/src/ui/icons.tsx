import type { ReactNode } from 'react';

/**
 * The application's icon set. One file so every glyph shares a viewBox, a
 * stroke weight and a cap style: an icon drawn to different rules reads as a
 * different control even when it sits in the same row. The measurements match
 * the shell's navigation icons, so a header icon and a sidebar icon are
 * visibly the same hand.
 *
 * One glyph means one action. An icon reused for a second, different action
 * stops being a word people can learn.
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
      strokeWidth="1.55"
      viewBox="0 0 20 20"
    >
      <path d={path} />
    </svg>
  );
}

/**
 * Work in progress. A faint ring with one bright arc, the shape Lumora's other
 * spinners already draw, so waiting looks the same wherever it happens. It
 * stands in for a button's own mark while the button works: turning the mark
 * itself would make a pair of chevrons or a download arrow look like the
 * action repeating.
 */
export function LoadingIcon(): ReactNode {
  return (
    <svg
      aria-hidden="true"
      className="icon icon-loading"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.55"
      viewBox="0 0 20 20"
    >
      <circle className="icon-loading-track" cx="10" cy="10" r="6.5" />
      <path d="M10 3.5a6.5 6.5 0 0 1 6.5 6.5" />
    </svg>
  );
}

/** Attaches images to a message: a framed picture. */
export function ImageIcon(): ReactNode {
  return (
    <Glyph path="M4.5 4.5h11a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM3.8 13.4l3.7-3.7 3 3 1.8-1.8 3.9 3.9M12.8 7.6v.1" />
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

/** Opens the detail behind a summary. */
export function InfoIcon(): ReactNode {
  return <Glyph path="M10 2.8a7.2 7.2 0 1 0 0 14.4 7.2 7.2 0 0 0 0-14.4M10 9v4.6M10 6.4v.1" />;
}

/** Fetches something that is not here yet. */
export function DownloadIcon(): ReactNode {
  return <Glyph path="M10 3.5v8m0 0 3.2-3.2M10 11.5 6.8 8.3M3.8 13.5v2a1 1 0 0 0 1 1h10.4a1 1 0 0 0 1-1v-2" />;
}

/**
 * Raises something already here to a newer version. Two chevrons rather than a
 * turning arrow, which already means "read it again", or a downward arrow,
 * which already means "fetch what is missing".
 */
export function UpdateIcon(): ReactNode {
  return <Glyph path="M5.6 14.4 10 10l4.4 4.4M5.6 9.4 10 5l4.4 4.4" />;
}

/** Starts a stopped session. */
export function PlayIcon(): ReactNode {
  return <Glyph path="M7 4.6v10.8l9-5.4z" />;
}

/** Goes to something that is already there. */
export function OpenIcon(): ReactNode {
  return <Glyph path="M11 3.5h5.5V9M16.5 3.5 9.5 10.5M15 12v3.5a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1H8" />;
}

/**
 * Shows a folder in the desktop's file manager. A plain folder rather than the
 * arrow of "go to something already there", which leaves the window.
 */
export function FolderIcon(): ReactNode {
  return (
    <Glyph path="M3.2 15V5.6a1 1 0 0 1 1-1h3.1l1.5 1.8h6a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1H4.2a1 1 0 0 1-1-1z" />
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
