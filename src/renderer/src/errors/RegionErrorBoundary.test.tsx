import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RegionErrorBoundary } from './RegionErrorBoundary';

function BrokenRegion({ broken }: { broken: boolean }) {
  if (broken) throw new Error('private renderer detail');
  return <p>Region recovered</p>;
}

describe('RegionErrorBoundary', () => {
  it('contains a renderer failure and retries only its owned region', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let broken = true;
    const view = render(
      <>
        <p>Navigation remains available</p>
        <RegionErrorBoundary
          description="Lumora kept the rest of the window available."
          heading="View unavailable"
          retryLabel="Retry this view"
        >
          <BrokenRegion broken={broken} />
        </RegionErrorBoundary>
      </>
    );

    expect(screen.getByRole('alert', { name: 'View unavailable' })).toBeVisible();
    expect(screen.getByText('Navigation remains available')).toBeVisible();
    expect(screen.queryByText('private renderer detail')).not.toBeInTheDocument();

    broken = false;
    view.rerender(
      <>
        <p>Navigation remains available</p>
        <RegionErrorBoundary
          description="Lumora kept the rest of the window available."
          heading="View unavailable"
          retryLabel="Retry this view"
        >
          <BrokenRegion broken={broken} />
        </RegionErrorBoundary>
      </>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry this view' }));

    expect(screen.getByText('Region recovered')).toBeVisible();
    consoleError.mockRestore();
  });

  it('recovers automatically when its reset key changes', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = render(
      <RegionErrorBoundary
        description="Another terminal remains available."
        heading="Terminal view unavailable"
        resetKey="runtime-a"
        retryLabel="Retry terminal view"
      >
        <BrokenRegion broken />
      </RegionErrorBoundary>
    );

    view.rerender(
      <RegionErrorBoundary
        description="Another terminal remains available."
        heading="Terminal view unavailable"
        resetKey="runtime-b"
        retryLabel="Retry terminal view"
      >
        <BrokenRegion broken={false} />
      </RegionErrorBoundary>
    );

    expect(screen.getByText('Region recovered')).toBeVisible();
    consoleError.mockRestore();
  });
});
