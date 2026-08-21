import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react';

import type {
  LaunchPreview,
  LumoraApi,
  RuntimeSummary,
  SystemInfo,
  WorkspaceSummary
} from '../../../shared/contracts';
import { ManagedTerminal } from './ManagedTerminal';
import { TerminalDetailsDialog } from './TerminalDetailsDialog';
import { providerDefinition } from '../../../shared/provider-definitions';
import { RegionErrorBoundary } from '../errors/RegionErrorBoundary';
import { OverflowTooltip } from '../ui/Tooltip';

interface TerminalWorkspaceProps {
  api?: LumoraApi;
  backgroundOpacity?: number;
  runtimes: readonly RuntimeSummary[];
  activeRuntimeId: string;
  focusRequestKey?: number;
  platform: SystemInfo['platform'];
  theme?: 'light' | 'dark';
  visible: boolean;
  previews: ReadonlyMap<string, LaunchPreview>;
  workspaces: readonly WorkspaceSummary[];
  onActivate(runtimeId: string): void;
  onReorder?(runtimeId: string, destinationIndex: number): void;
  onRuntimeChange(runtime: RuntimeSummary): void;
}

interface TabDrag {
  captureElement: HTMLButtonElement;
  destinationIndex: number;
  dragging: boolean;
  originX: number;
  pointerId: number;
  runtimeId: string;
}

const TAB_DRAG_THRESHOLD = 5;

export function TerminalWorkspace({
  api = window.lumora,
  backgroundOpacity = 1,
  runtimes,
  activeRuntimeId,
  focusRequestKey = 0,
  platform,
  theme = 'dark',
  visible,
  previews,
  workspaces,
  onActivate,
  onReorder,
  onRuntimeChange
}: TerminalWorkspaceProps): ReactNode {
  const [stoppingRuntimeIds, setStoppingRuntimeIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [dragPresentation, setDragPresentation] = useState<{
    destinationIndex: number;
    runtimeId: string;
  } | null>(null);
  const [reorderAnnouncement, setReorderAnnouncement] = useState('');
  const dragRef = useRef<TabDrag | null>(null);
  const suppressedClickRuntimeId = useRef<string | null>(null);

  const clearDrag = () => {
    const drag = dragRef.current;
    if (
      drag !== null &&
      typeof drag.captureElement.releasePointerCapture === 'function' &&
      drag.captureElement.hasPointerCapture?.(drag.pointerId)
    ) {
      drag.captureElement.releasePointerCapture(drag.pointerId);
    }
    dragRef.current = null;
    setDragPresentation(null);
  };

  useEffect(() => {
    const drag = dragRef.current;
    if (
      drag !== null &&
      !runtimes.some((item) => item.id === drag.runtimeId)
    ) {
      clearDrag();
    }
  }, [runtimes]);

  const runtime = runtimes.find((item) => item.id === activeRuntimeId) ?? runtimes[0];
  if (runtime === undefined) return null;
  const preview = previews.get(runtime.id);
  const workspace = workspaces.find((item) => item.id === runtime.workspaceId);
  const isLive = runtime.state === 'launching' || runtime.state === 'running';
  const stopping = stoppingRuntimeIds.has(runtime.id);
  const providerName = providerDefinition(runtime.provider).displayName;

  const handleTabPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    runtimeId: string,
    sourceIndex: number
  ) => {
    if (event.button !== 0 || onReorder === undefined) return;
    dragRef.current = {
      captureElement: event.currentTarget,
      destinationIndex: sourceIndex,
      dragging: false,
      originX: event.clientX,
      pointerId: event.pointerId,
      runtimeId
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handleTabPointerMove = (
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    if (
      !drag.dragging &&
      Math.abs(event.clientX - drag.originX) < TAB_DRAG_THRESHOLD
    ) {
      return;
    }

    const otherTabs = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('.terminal-tab')
    ).filter((tab) => tab.dataset.runtimeId !== drag.runtimeId);
    const firstTabAfterPointer = otherTabs.findIndex((tab) => {
      const bounds = tab.getBoundingClientRect();
      return event.clientX < bounds.left + bounds.width / 2;
    });
    const destinationIndex =
      firstTabAfterPointer === -1 ? otherTabs.length : firstTabAfterPointer;

    drag.dragging = true;
    drag.destinationIndex = destinationIndex;
    setDragPresentation({ destinationIndex, runtimeId: drag.runtimeId });
    event.preventDefault();
  };

  const handleTabPointerEnd = (
    event: ReactPointerEvent<HTMLDivElement>,
    commit: boolean
  ) => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    const shouldReorder = commit && drag.dragging;
    const { destinationIndex, runtimeId } = drag;
    clearDrag();
    if (!shouldReorder || onReorder === undefined) return;

    suppressedClickRuntimeId.current = runtimeId;
    window.setTimeout(() => {
      if (suppressedClickRuntimeId.current === runtimeId) {
        suppressedClickRuntimeId.current = null;
      }
    }, 0);
    onReorder(runtimeId, destinationIndex);
    const movedRuntime = runtimes.find((item) => item.id === runtimeId);
    setReorderAnnouncement(
      `${movedRuntime?.displayName ?? 'Terminal'} moved to position ${
        destinationIndex + 1
      } of ${runtimes.length}.`
    );
  };

  const handleTabKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    runtimeId: string,
    sourceIndex: number
  ) => {
    if (
      onReorder === undefined ||
      !event.altKey ||
      !event.shiftKey ||
      event.ctrlKey ||
      event.metaKey ||
      (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight')
    ) {
      return;
    }
    const destinationIndex =
      sourceIndex + (event.code === 'ArrowLeft' ? -1 : 1);
    if (destinationIndex < 0 || destinationIndex >= runtimes.length) return;

    event.preventDefault();
    onReorder(runtimeId, destinationIndex);
    const movedRuntime = runtimes[sourceIndex];
    setReorderAnnouncement(
      `${movedRuntime?.displayName ?? 'Terminal'} moved to position ${
        destinationIndex + 1
      } of ${runtimes.length}.`
    );
  };

  const stop = () => {
    const runtimeId = runtime.id;
    setStoppingRuntimeIds((current) => new Set(current).add(runtimeId));
    const clearStopping = () => {
      setStoppingRuntimeIds((current) => {
        if (!current.has(runtimeId)) return current;
        const next = new Set(current);
        next.delete(runtimeId);
        return next;
      });
    };
    void api.terminateRuntime(runtimeId).then(
      (value) => {
        onRuntimeChange(value);
        clearStopping();
      },
      clearStopping
    );
  };

  return (
    <section className="terminal-workspace" aria-label="Managed terminals">
      <div
        className="terminal-tabbar"
        role="tablist"
        aria-label="Terminal tabs"
        onPointerCancel={(event) => handleTabPointerEnd(event, false)}
        onPointerMove={handleTabPointerMove}
        onPointerUp={(event) => handleTabPointerEnd(event, true)}
      >
        {runtimes.map((item, index) => {
          const draggedIndex =
            dragPresentation === null
              ? -1
              : runtimes.findIndex(
                  (candidate) => candidate.id === dragPresentation.runtimeId
                );
          const dropBefore =
            dragPresentation !== null &&
            dragPresentation.destinationIndex < draggedIndex &&
            index === dragPresentation.destinationIndex;
          const dropAfter =
            dragPresentation !== null &&
            dragPresentation.destinationIndex > draggedIndex &&
            index === dragPresentation.destinationIndex;
          return (
            <button
              aria-grabbed={
                dragPresentation?.runtimeId === item.id ? true : undefined
              }
              aria-selected={item.id === runtime.id}
              className={[
                'terminal-tab',
                dragPresentation?.runtimeId === item.id
                  ? 'terminal-tab-dragging'
                  : '',
                dropBefore ? 'terminal-tab-drop-before' : '',
                dropAfter ? 'terminal-tab-drop-after' : ''
              ]
                .filter(Boolean)
                .join(' ')}
              data-runtime-id={item.id}
              key={item.id}
              onClick={() => {
                if (suppressedClickRuntimeId.current === item.id) {
                  suppressedClickRuntimeId.current = null;
                  return;
                }
                onActivate(item.id);
              }}
              onKeyDown={(event) => handleTabKeyDown(event, item.id, index)}
              onPointerDown={(event) =>
                handleTabPointerDown(event, item.id, index)
              }
              role="tab"
              type="button"
            >
              <OverflowTooltip content={item.displayName}>
                <span className="terminal-tab-title">
                  {item.displayName}
                </span>
              </OverflowTooltip>
              <small>
                {providerDefinition(item.provider).displayName} ·{' '}
                {item.state}
              </small>
            </button>
          );
        })}
        <span
          aria-live="polite"
          className="terminal-reorder-announcement"
          role="status"
        >
          {reorderAnnouncement}
        </span>
      </div>

      <header className="terminal-header">
        <div>
          <p className="card-label">
            {workspace?.displayName ?? 'Workspace'} · {providerName} terminal
          </p>
          <h2>{runtime.displayName}</h2>
        </div>
        <div className="catalog-actions">
          <span className={`runtime-state runtime-${runtime.state}`}>{runtime.state}</span>
          <button
            className="secondary-button"
            onClick={() => setDetailsOpen(true)}
            type="button"
          >
            Terminal details
          </button>
          <button className="secondary-button" disabled={!isLive || stopping} onClick={stop} type="button">
            {stopping ? 'Stopping' : 'Stop'}
          </button>
        </div>
      </header>

      <div className="terminal-grid">
        {runtimes.map((item) => (
          <div
            aria-hidden={item.id !== runtime.id}
            className="terminal-panel"
            hidden={item.id !== runtime.id}
            key={item.id}
          >
            <RegionErrorBoundary
              description="This terminal process remains active. Retry its view to reattach without affecting other tabs."
              heading="Terminal view unavailable"
              resetKey={`${item.id}:${item.state}`}
              retryLabel="Retry terminal view"
            >
            <ManagedTerminal
              active={visible && item.id === runtime.id}
              api={api}
              backgroundOpacity={backgroundOpacity}
              focusRequestKey={focusRequestKey}
              platform={platform}
              runtime={item}
              theme={theme}
              onRuntimeChange={onRuntimeChange}
            />
            </RegionErrorBoundary>
          </div>
        ))}
      </div>

      {detailsOpen ? (
        <TerminalDetailsDialog
          onClose={() => setDetailsOpen(false)}
          preview={preview}
          runtime={runtime}
          workspace={workspace}
        />
      ) : null}
    </section>
  );
}
