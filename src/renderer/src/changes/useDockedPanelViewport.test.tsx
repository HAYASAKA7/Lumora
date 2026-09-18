import { act, render } from '@testing-library/react';
import { useRef, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDockedPanelViewport } from './useDockedPanelViewport';

function Harness({ active = true, hostWidth = 1000, toolbar = false }: {
  active?: boolean;
  hostWidth?: number;
  toolbar?: boolean;
}): ReactNode {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useDockedPanelViewport(hostRef, active);
  return (
    <div className="scroller" data-testid="scroller">
      <div data-host-width={hostWidth} data-testid="host" ref={hostRef}>
        {toolbar ? <div className="page-toolbar" /> : null}
        <aside className="changes-panel" data-testid="panel" />
      </div>
    </div>
  );
}

function stubLayout(options: {
  containerTop: number;
  containerHeight: number;
  panelTop: number;
  toolbarHeight?: number;
}) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = this.classList.contains('scroller')
      ? options.containerTop
      : this.classList.contains('changes-panel') ? options.panelTop : 0;
    const height = this.classList.contains('page-toolbar') ? options.toolbarHeight ?? 0 : 0;
    return { top, bottom: top + height, left: 0, right: 0, width: 0, height, x: 0, y: top, toJSON: () => ({}) };
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('scroller') ? options.containerHeight : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return Number(this.dataset.hostWidth ?? 0);
  });
  vi.spyOn(window, 'getComputedStyle').mockImplementation(((element: Element) => ({
    overflowY: element.classList.contains('scroller') ? 'auto' : 'visible',
    getPropertyValue: (name: string) => name === '--page-toolbar-inset' ? '14px' : ''
  })) as typeof window.getComputedStyle);
}

function height(host: HTMLElement): string {
  return host.style.getPropertyValue('--changes-panel-visible-height');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useDockedPanelViewport', () => {
  it('sizes the panel to what is visible of the scrolling container below it', () => {
    stubLayout({ containerTop: 60, containerHeight: 800, panelTop: 200 });
    const { getByTestId } = render(<Harness />);
    // The panel starts 200px down a container that ends at 860, less the bottom gap.
    expect(height(getByTestId('host'))).toBe('648px');
  });

  it('measures again when the container scrolls', () => {
    stubLayout({ containerTop: 60, containerHeight: 800, panelTop: 200 });
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const { getByTestId } = render(<Harness />);

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const top = this.classList.contains('scroller') ? 60 : this.classList.contains('changes-panel') ? 72 : 0;
      return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) };
    });
    act(() => {
      getByTestId('scroller').dispatchEvent(new Event('scroll'));
      for (const frame of frames.splice(0)) frame(0);
    });
    // Once scrolled the panel sticks at the container top plus the gap.
    expect(height(getByTestId('host'))).toBe('776px');
  });

  it('writes nothing again while the measurements stay put', () => {
    stubLayout({ containerTop: 60, containerHeight: 800, panelTop: 200 });
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const { getByTestId } = render(<Harness />);
    const setProperty = vi.spyOn(getByTestId('host').style, 'setProperty');

    act(() => {
      getByTestId('scroller').dispatchEvent(new Event('scroll'));
      for (const frame of frames.splice(0)) frame(0);
    });
    expect(setProperty).not.toHaveBeenCalled();
    expect(height(getByTestId('host'))).toBe('648px');
  });

  it('stacks the panel under the sessions on a narrow page and measures the whole container', () => {
    stubLayout({ containerTop: 0, containerHeight: 600, panelTop: 900 });
    const { getByTestId } = render(<Harness hostWidth={600} />);
    const host = getByTestId('host');
    expect(host.dataset.changesLayout).toBe('stacked');
    expect(height(host)).toBe('576px');
  });

  it('docks the panel under a pinned page toolbar and leaves what it covers out', () => {
    stubLayout({ containerTop: 60, containerHeight: 800, panelTop: 220, toolbarHeight: 60 });
    const { getByTestId } = render(<Harness toolbar />);
    const host = getByTestId('host');
    // The stylesheet docks the panel 12px under a toolbar pinned 14px down.
    expect(host.style.getPropertyValue('--page-toolbar-height')).toBe('60px');
    expect(height(host)).toBe('628px');
  });

  it('keeps a stacked panel to what shows under a pinned page toolbar', () => {
    stubLayout({ containerTop: 60, containerHeight: 800, panelTop: 900, toolbarHeight: 60 });
    const { getByTestId } = render(<Harness hostWidth={600} toolbar />);
    // 860 at the bottom of the page, less the 134 the pinned toolbar covers and both gaps.
    expect(height(getByTestId('host'))).toBe('702px');
  });

  it('writes nothing while inactive and clears what it wrote', () => {
    stubLayout({ containerTop: 0, containerHeight: 600, panelTop: 10 });
    const { getByTestId, rerender } = render(<Harness active={false} hostWidth={600} />);
    expect(height(getByTestId('host'))).toBe('');
    expect(getByTestId('host').dataset.changesLayout).toBeUndefined();

    rerender(<Harness hostWidth={600} />);
    expect(height(getByTestId('host'))).not.toBe('');
    rerender(<Harness active={false} hostWidth={600} />);
    expect(height(getByTestId('host'))).toBe('');
    expect(getByTestId('host').style.getPropertyValue('--page-toolbar-height')).toBe('');
    expect(getByTestId('host').dataset.changesLayout).toBeUndefined();
  });
});
