import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import type { ChangesSource } from '../../../shared/contracts';
import { useShortcutLabel } from '../keyboard/ShortcutLabels';
import { useLocalization } from '../localization/useLocalization';
import { CloseButton } from '../ui/CloseButton';
import { IconButton } from '../ui/IconButton';
import { MaximizeIcon, RestoreIcon } from '../ui/icons';
import {
  CHANGES_PANEL_MIN_WIDTH,
  clampPanelWidth,
  readPanelWidth,
  writePanelWidth
} from './changes-panel-preference';
import { ChangesPanelContent, type ChangesPanelMode } from './ChangesPanelContent';
import { useResizeDrag } from './useResizeDrag';
import type { ChangesApi } from './useWorkspaceChanges';

/** How far one arrow key press moves the panel's edge. */
const KEYBOARD_RESIZE_STEP = 24;
/** Written on the parent so the parent's layout can size the panel's column. */
const COLUMN_WIDTH_PROPERTY = '--changes-column-width';

interface ChangesPanelProps {
  api: ChangesApi;
  source: ChangesSource;
  /** Lets a control that opens the panel name it through aria-controls. */
  id?: string;
  /** False while the panel is kept mounted but hidden; nothing loads then. */
  active?: boolean;
  onClose(): void;
  onSourceChange?(source: ChangesSource): void;
  /** Whether the panel fills its host; left out only where nothing tracks it. */
  maximized?: boolean;
  onMaximizedChange?(maximized: boolean): void;
  /** Opens a source straight into its workspace's review history. */
  initialMode?: ChangesPanelMode;
  sessionTitle?(catalogSessionId: string): string | null;
  highlightSessionId?: string | null;
}

/** The width the panel may take from; the window's width before the panel has a parent to measure. */
function measureAvailable(panel: HTMLElement | null): number {
  const parentWidth = panel?.parentElement?.clientWidth ?? 0;
  return parentWidth > 0 ? parentWidth : window.innerWidth;
}

export function ChangesPanel({
  active = true,
  api,
  highlightSessionId = null,
  id,
  initialMode = 'changes',
  maximized: hostMaximized,
  onClose,
  onMaximizedChange,
  onSourceChange,
  sessionTitle,
  source
}: ChangesPanelProps): ReactNode {
  const { t } = useLocalization();
  const maximizeShortcut = useShortcutLabel('maximizeChanges');
  const panelRef = useRef<HTMLElement | null>(null);
  const sourceKey = JSON.stringify(source);
  const [trackedKey, setTrackedKey] = useState(sourceKey);
  const [currentSource, setCurrentSource] = useState(source);
  const [width, setWidth] = useState(() => readPanelWidth(window));
  const [availableWidth, setAvailableWidth] = useState(() => window.innerWidth);
  // The host keeps this state, so a panel it restores for another session opens restored.
  const [ownMaximized, setOwnMaximized] = useState(false);
  const maximized = hostMaximized ?? ownMaximized;

  if (trackedKey !== sourceKey) {
    setTrackedKey(sourceKey);
    setCurrentSource(source);
  }

  const shownWidth = clampPanelWidth(width, availableWidth);
  const maxWidth = clampPanelWidth(Number.MAX_SAFE_INTEGER, availableWidth);

  useLayoutEffect(() => {
    const parent = panelRef.current?.parentElement;
    if (parent === null || parent === undefined) return undefined;
    const measure = () => setAvailableWidth(measureAvailable(panelRef.current));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    // A narrower parent narrows the shown width without changing the saved one.
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    panelRef.current?.parentElement?.style.setProperty(COLUMN_WIDTH_PROPERTY, `${shownWidth}px`);
  }, [shownWidth]);

  useLayoutEffect(() => {
    const parent = panelRef.current?.parentElement;
    return () => {
      parent?.style.removeProperty(COLUMN_WIDTH_PROPERTY);
    };
  }, []);

  const commitWidth = (next: number) => {
    const available = measureAvailable(panelRef.current);
    setAvailableWidth(available);
    const clamped = clampPanelWidth(next, available);
    if (clamped === shownWidth) return;
    setWidth(clamped);
    writePanelWidth(window, clamped);
  };

  const { cancelDrag, handlers: dragHandlers } = useResizeDrag({ availableWidth, commitWidth, shownWidth });

  const changeSource = (next: ChangesSource) => {
    setCurrentSource(next);
    onSourceChange?.(next);
  };

  const toggleMaximized = () => {
    const next = !maximized;
    cancelDrag();
    if (hostMaximized === undefined) setOwnMaximized(next);
    onMaximizedChange?.(next);
  };

  const handleResizeKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const targets: Record<string, number> = {
      ArrowLeft: shownWidth + KEYBOARD_RESIZE_STEP,
      ArrowRight: shownWidth - KEYBOARD_RESIZE_STEP,
      Home: CHANGES_PANEL_MIN_WIDTH,
      End: maxWidth
    };
    const target = targets[event.key];
    if (target === undefined) return;
    event.preventDefault();
    commitWidth(target);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    // An open menu takes Escape for itself.
    if (event.currentTarget.querySelector('[aria-haspopup="menu"][aria-expanded="true"]') !== null) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  return (
    <aside
      aria-label={t('terminal.changes.panel-title')}
      className="changes-panel"
      data-maximized={maximized}
      id={id}
      onKeyDown={handleKeyDown}
      ref={panelRef}
    >
      {maximized ? null : (
        <div
          aria-label={t('terminal.changes.resize')}
          aria-orientation="vertical"
          aria-valuemax={maxWidth}
          aria-valuemin={CHANGES_PANEL_MIN_WIDTH}
          aria-valuenow={shownWidth}
          className="changes-panel-resize"
          onKeyDown={handleResizeKey}
          {...dragHandlers}
          role="separator"
          tabIndex={0}
        />
      )}
      <div className="changes-panel-header">
        <h2>{t('terminal.changes.panel-title')}</h2>
        <div className="changes-panel-actions">
          <IconButton
            label={t(maximized ? 'terminal.changes.restore' : 'terminal.changes.maximize')}
            shortcut={maximizeShortcut}
            onClick={toggleMaximized}
          >
            {maximized ? <RestoreIcon /> : <MaximizeIcon />}
          </IconButton>
          <CloseButton label={t('terminal.changes.close')} onClose={onClose} />
        </div>
      </div>
      <ChangesPanelContent
        active={active}
        api={api}
        highlightSessionId={highlightSessionId}
        initialMode={initialMode}
        key={trackedKey}
        onSourceChange={changeSource}
        sessionTitle={sessionTitle}
        source={currentSource}
      />
    </aside>
  );
}
