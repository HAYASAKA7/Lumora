import { useLayoutEffect, type RefObject } from 'react';

/** Below this host width a second column would be too narrow to read, so the panel stacks. */
export const STACKED_LAYOUT_MAX_WIDTH = 720;
/** Breathing room kept above and below the panel inside its scroll container. */
const VIEWPORT_GAP = 12;
const HEIGHT_PROPERTY = '--changes-panel-visible-height';
/** The pinned page toolbar the panel docks under. */
const TOOLBAR_HEIGHT_PROPERTY = '--page-toolbar-height';

interface Viewport {
  top: number;
  bottom: number;
}

/** The nearest ancestor that scrolls, or null when the page itself scrolls. */
function scrollContainer(host: HTMLElement): HTMLElement | null {
  const view = host.ownerDocument.defaultView;
  for (let node = host.parentElement; node !== null; node = node.parentElement) {
    const overflow = view?.getComputedStyle(node).overflowY ?? '';
    if (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') return node;
  }
  return null;
}

/** How far under the top of the page the stylesheet pins a page toolbar. */
function toolbarInset(host: HTMLElement): number {
  const style = host.ownerDocument.defaultView?.getComputedStyle(host);
  const inset = Number.parseFloat(style?.getPropertyValue?.('--page-toolbar-inset') ?? '');
  return Number.isFinite(inset) ? inset : 0;
}

function viewportOf(host: HTMLElement, container: HTMLElement | null): Viewport {
  if (container === null) {
    const height = host.ownerDocument.defaultView?.innerHeight ?? 0;
    return { top: 0, bottom: height };
  }
  const rect = container.getBoundingClientRect();
  // clientHeight leaves out a horizontal scrollbar that the rect still covers.
  return { top: rect.top, bottom: rect.top + container.clientHeight };
}

/**
 * Sizes a docked changes panel to what is visible of its scrolling container and
 * says when the host is too narrow for a second column. Both are written on the
 * host so the stylesheet can place the panel without any fixed height.
 */
export function useDockedPanelViewport(hostRef: RefObject<HTMLElement | null>, active: boolean): void {
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!active || host === null) return undefined;
    const view = host.ownerDocument.defaultView;
    const container = scrollContainer(host);
    let frame: number | null = null;
    let written: string | null = null;
    let writtenToolbar: string | null = null;

    const measure = () => {
      frame = null;
      const viewport = viewportOf(host, container);
      const panel = host.querySelector<HTMLElement>(':scope > .changes-panel');
      const toolbar = host.querySelector<HTMLElement>(':scope > .page-toolbar');
      const toolbarHeight = toolbar === null ? 0 : Math.round(toolbar.getBoundingClientRect().height);
      // What the pinned toolbar covers is not visible to the panel.
      const visibleTop = viewport.top + (toolbar === null ? 0 : toolbarInset(host) + toolbarHeight);
      const stacked = host.clientWidth > 0 && host.clientWidth < STACKED_LAYOUT_MAX_WIDTH;
      const panelTop = stacked || panel === null ? visibleTop : panel.getBoundingClientRect().top;
      const top = Math.max(visibleTop + VIEWPORT_GAP, panelTop);
      const available = viewport.bottom - visibleTop;
      const height = `${Math.round(Math.max(viewport.bottom - VIEWPORT_GAP - top, available / 2))}px`;
      // Writing the same height again would resize nothing and only feed the observer its own work.
      if (height !== written) {
        written = height;
        host.style.setProperty(HEIGHT_PROPERTY, height);
      }
      const toolbarValue = `${toolbarHeight}px`;
      if (toolbarValue !== writtenToolbar) {
        writtenToolbar = toolbarValue;
        host.style.setProperty(TOOLBAR_HEIGHT_PROPERTY, toolbarValue);
      }
      const layout = stacked ? 'stacked' : undefined;
      if (host.dataset.changesLayout === layout) return;
      if (layout === undefined) delete host.dataset.changesLayout;
      else host.dataset.changesLayout = layout;
    };

    const schedule = () => {
      if (frame !== null || view === null || view === undefined) return;
      frame = view.requestAnimationFrame(measure);
    };

    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(host);
    if (container !== null) observer?.observe(container);
    const scroller: EventTarget = container ?? view ?? host;
    scroller.addEventListener('scroll', schedule, { passive: true });
    view?.addEventListener('resize', schedule);

    return () => {
      if (frame !== null) view?.cancelAnimationFrame(frame);
      observer?.disconnect();
      scroller.removeEventListener('scroll', schedule);
      view?.removeEventListener('resize', schedule);
      host.style.removeProperty(HEIGHT_PROPERTY);
      host.style.removeProperty(TOOLBAR_HEIGHT_PROPERTY);
      delete host.dataset.changesLayout;
    };
  }, [active, hostRef]);
}
