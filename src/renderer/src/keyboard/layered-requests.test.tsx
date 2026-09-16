import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { createSurfaceRequest } from './layered-requests';

function Surface({ active = true, answer, request }: {
  active?: boolean;
  answer(): void;
  request: ReturnType<typeof createSurfaceRequest>;
}): ReactNode {
  request.useRequest(active, answer);
  return null;
}

describe('createSurfaceRequest', () => {
  it('reports that nobody answered', () => {
    const request = createSurfaceRequest();
    expect(request.request()).toBe(false);
  });

  it('gives the request to the surface that opened last', () => {
    const request = createSurfaceRequest();
    const page = vi.fn();
    const panel = vi.fn();
    const view = render(<Surface answer={page} request={request} />);

    expect(request.request()).toBe(true);
    expect(page).toHaveBeenCalledTimes(1);

    view.rerender(
      <>
        <Surface answer={page} request={request} />
        <Surface answer={panel} request={request} />
      </>
    );
    expect(request.request()).toBe(true);
    expect(panel).toHaveBeenCalledTimes(1);
    expect(page).toHaveBeenCalledTimes(1);

    // The panel closes and the page answers again.
    view.rerender(<Surface answer={page} request={request} />);
    expect(request.request()).toBe(true);
    expect(page).toHaveBeenCalledTimes(2);
    expect(panel).toHaveBeenCalledTimes(1);
  });

  it('passes over a surface that is busy or not in front', () => {
    const request = createSurfaceRequest();
    const page = vi.fn();
    const busyPanel = vi.fn();
    render(
      <>
        <Surface answer={page} request={request} />
        <Surface active={false} answer={busyPanel} request={request} />
      </>
    );

    expect(request.request()).toBe(true);
    expect(busyPanel).not.toHaveBeenCalled();
    expect(page).toHaveBeenCalledTimes(1);
  });

  it('answers with the newest handler a surface was given', () => {
    const request = createSurfaceRequest();
    const first = vi.fn();
    const second = vi.fn();
    const view = render(<Surface answer={first} request={request} />);

    view.rerender(<Surface answer={second} request={request} />);
    request.request();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('forgets a surface once it unmounts', () => {
    const request = createSurfaceRequest();
    const answer = vi.fn();
    render(<Surface answer={answer} request={request} />).unmount();

    expect(request.request()).toBe(false);
    expect(answer).not.toHaveBeenCalled();
  });
});
