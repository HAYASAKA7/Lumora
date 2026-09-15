import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode
} from 'react';

import type { ChangesSource } from '../../../shared/contracts';
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
import { ChangesView } from './ChangesView';
import type { ChangesApi } from './useWorkspaceChanges';

/** How far one arrow key press moves the panel's edge. */
const KEYBOARD_RESIZE_STEP = 24;
/** Written on the parent so the parent's layout can size the panel's column. */
const COLUMN_WIDTH_PROPERTY = '--changes-column-width';
const GUIDE_OFFSET_PROPERTY = '--changes-resize-guide-offset';

interface ChangesPanelProps {
  api: ChangesApi;
  source: ChangesSource;
  /** Lets a control that opens the panel name it through aria-controls. */
  id?: string;
  /** False while the panel is kept mounted but hidden; nothing loads then. */
  active?: boolean;
  onClose(): void;
  onSourceChange?(source: ChangesSource): void;
  onMaximizedChange?(maximized: boolean): void;
}

interface Drag {
  pointerId: number;
  target: HTMLElement;
  startX: number;
  startWidth: number;
  width: number;
  cancelOnEscape(event: globalThis.KeyboardEvent): void;
}

/** The width the panel may take from; the window's width before the panel has a parent to measure. */
function measureAvailable(panel: HTMLElement | null): number {
  const parentWidth = panel?.parentElement?.clientWidth ?? 0;
  return parentWidth > 0 ? parentWidth : window.innerWidth;
}

export function ChangesPanel({
  active = true,
  api,
  id,
  onClose,
  onMaximizedChange,
  onSourceChange,
  source
}: ChangesPanelProps): ReactNode {
  const { t } = useLocalization();
  const panelRef = useRef<HTMLElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const sourceKey = JSON.stringify(source);
  const [trackedKey, setTrackedKey] = useState(sourceKey);
  const [currentSource, setCurrentSource] = useState(source);
  const [width, setWidth] = useState(() => readPanelWidth(window));
  const [availableWidth, setAvailableWidth] = useState(() => window.innerWidth);
  const [maximized, setMaximized] = useState(false);

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

  const showGuide = (target: HTMLElement, offset: number | null) => {
    if (offset === null) {
      delete target.dataset.dragging;
      target.style.removeProperty(GUIDE_OFFSET_PROPERTY);
      return;
    }
    target.dataset.dragging = 'true';
    target.style.setProperty(GUIDE_OFFSET_PROPERTY, `${offset}px`);
  };

  /** Ends a drag; returns it so the caller can commit or restore. */
  const endDrag = (): Drag | null => {
    const current = drag.current;
    if (current === null) return null;
    drag.current = null;
    window.removeEventListener('keydown', current.cancelOnEscape, true);
    showGuide(current.target, null);
    if (current.target.hasPointerCapture?.(current.pointerId)) {
      current.target.releasePointerCapture(current.pointerId);
    }
    return current;
  };

  const cancelDrag = () => {
    endDrag();
  };
  const cancelDragRef = useRef(cancelDrag);
  cancelDragRef.current = cancelDrag;

  useEffect(() => () => cancelDragRef.current(), []);

  const changeSource = (next: ChangesSource) => {
    setCurrentSource(next);
    onSourceChange?.(next);
  };

  const toggleMaximized = () => {
    const next = !maximized;
    cancelDrag();
    setMaximized(next);
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

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || drag.current !== null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const cancelOnEscape = (keyEvent: globalThis.KeyboardEvent) => {
      if (keyEvent.key !== 'Escape') return;
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      cancelDragRef.current();
    };
    window.addEventListener('keydown', cancelOnEscape, true);
    drag.current = {
      pointerId: event.pointerId,
      target: event.currentTarget,
      startX: event.clientX,
      startWidth: shownWidth,
      width: shownWidth,
      cancelOnEscape
    };
  };

  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (current === null || current.pointerId !== event.pointerId) return;
    // Only a guide follows the pointer so the session beside the panel resizes once on release.
    current.width = clampPanelWidth(current.startWidth + current.startX - event.clientX, availableWidth);
    showGuide(current.target, current.startWidth - current.width);
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    const current = endDrag();
    if (current !== null) commitWidth(current.width);
  };

  const abandonDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === event.pointerId) cancelDrag();
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
          onLostPointerCapture={abandonDrag}
          onPointerCancel={abandonDrag}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={finishDrag}
          role="separator"
          tabIndex={0}
        />
      )}
      <div className="changes-panel-header">
        <h2>{t('terminal.changes.panel-title')}</h2>
        <div className="changes-panel-actions">
          <IconButton
            label={t(maximized ? 'terminal.changes.restore' : 'terminal.changes.maximize')}
            onClick={toggleMaximized}
          >
            {maximized ? <RestoreIcon /> : <MaximizeIcon />}
          </IconButton>
          <CloseButton label={t('terminal.changes.close')} onClose={onClose} />
        </div>
      </div>
      <ChangesView active={active} api={api} onSourceChange={changeSource} source={currentSource} />
    </aside>
  );
}
