import {
  useRef,
  useState,
  type CSSProperties,
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
const WIDTH_PROPERTY = '--changes-panel-width';

interface ChangesPanelProps {
  api: ChangesApi;
  source: ChangesSource;
  onClose(): void;
  onSourceChange?(source: ChangesSource): void;
}

interface Drag {
  pointerId: number;
  startX: number;
  startWidth: number;
  width: number;
}

export function ChangesPanel({ api, onClose, onSourceChange, source }: ChangesPanelProps): ReactNode {
  const { t } = useLocalization();
  const panelRef = useRef<HTMLElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const sourceKey = JSON.stringify(source);
  const [trackedKey, setTrackedKey] = useState(sourceKey);
  const [currentSource, setCurrentSource] = useState(source);
  const [width, setWidth] = useState(() => readPanelWidth(window));
  const [maximized, setMaximized] = useState(false);

  if (trackedKey !== sourceKey) {
    setTrackedKey(sourceKey);
    setCurrentSource(source);
  }

  const available = (): number => {
    const parentWidth = panelRef.current?.parentElement?.clientWidth ?? 0;
    return parentWidth > 0 ? parentWidth : window.innerWidth;
  };
  const shownWidth = clampPanelWidth(width, available());

  const commitWidth = (next: number) => {
    const clamped = clampPanelWidth(next, available());
    setWidth(clamped);
    writePanelWidth(window, clamped);
  };

  const changeSource = (next: ChangesSource) => {
    setCurrentSource(next);
    onSourceChange?.(next);
  };

  const handleResizeKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    commitWidth(shownWidth + (event.key === 'ArrowLeft' ? KEYBOARD_RESIZE_STEP : -KEYBOARD_RESIZE_STEP));
  };

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: shownWidth, width: shownWidth };
  };

  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (current === null || current.pointerId !== event.pointerId) return;
    // The edge follows the pointer without re-rendering; the width commits on release.
    current.width = clampPanelWidth(current.startWidth + current.startX - event.clientX, available());
    panelRef.current?.style.setProperty(WIDTH_PROPERTY, `${current.width}px`);
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (current === null || current.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    commitWidth(current.width);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    // An open menu takes Escape for itself.
    if (event.currentTarget.querySelector('[aria-haspopup="menu"][aria-expanded="true"]') !== null) return;
    event.preventDefault();
    onClose();
  };

  return (
    <aside
      aria-label={t('terminal.changes.panel-title')}
      className="changes-panel"
      data-maximized={maximized}
      onKeyDown={handleKeyDown}
      ref={panelRef}
      style={{ [WIDTH_PROPERTY]: `${shownWidth}px` } as CSSProperties}
    >
      {maximized ? null : (
        <div
          aria-label={t('terminal.changes.resize')}
          aria-orientation="vertical"
          aria-valuemax={clampPanelWidth(Number.MAX_SAFE_INTEGER, available())}
          aria-valuemin={CHANGES_PANEL_MIN_WIDTH}
          aria-valuenow={shownWidth}
          className="changes-panel-resize"
          onKeyDown={handleResizeKey}
          onLostPointerCapture={endDrag}
          onPointerCancel={endDrag}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          role="separator"
          tabIndex={0}
        />
      )}
      <div className="changes-panel-header">
        <h2>{t('terminal.changes.panel-title')}</h2>
        <div className="changes-panel-actions">
          <IconButton
            label={t(maximized ? 'terminal.changes.restore' : 'terminal.changes.maximize')}
            onClick={() => setMaximized((current) => !current)}
          >
            {maximized ? <RestoreIcon /> : <MaximizeIcon />}
          </IconButton>
          <CloseButton label={t('terminal.changes.close')} onClose={onClose} />
        </div>
      </div>
      <ChangesView active api={api} onSourceChange={changeSource} source={currentSource} />
    </aside>
  );
}
