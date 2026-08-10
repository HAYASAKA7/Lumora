import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '../ui/Tooltip';
import { LumoraShell } from './LumoraShell';

describe('LumoraShell', () => {
  it('renders scoped navigation and one application content region', () => {
    const navigate = vi.fn();
    render(
      <TooltipProvider>
        <LumoraShell
          activeRouteId="home"
          appearance={{
            backgroundActive: false,
            backgroundStyle: undefined,
            hasSurfaceMosaic: false,
            shellStyle: {},
            theme: 'lumora'
          }}
          banner={<div role="alert">Remote data is stale</div>}
          main={<section>Remote home content</section>}
          onNavigate={navigate}
          onToggleSidebar={vi.fn()}
          pageHeader={{
            description: 'Remote overview',
            eyebrow: 'Remote computer',
            label: 'Home'
          }}
          primaryNavigation={{
            label: 'Remote',
            routes: [
              { id: 'home', icon: 'home', label: 'Home' },
              { id: 'sessions', icon: 'sessions', label: 'All sessions' }
            ]
          }}
          secondaryNavigation={{
            label: 'Target actions',
            routes: [{ id: 'settings', icon: 'settings', label: 'Settings' }]
          }}
          sidebarExpanded
          statusBar={<footer role="status">Remote target ready</footer>}
          topbar={{ context: 'work@server', kicker: 'Remote Lumora' }}
        />
      </TooltipProvider>
    );

    const shell = screen.getByTestId('lumora-shell');
    expect(shell).toHaveClass('app-shell');
    expect(shell).toHaveAttribute('data-theme', 'lumora');
    expect(screen.getByRole('main')).toHaveClass('main-content');
    expect(screen.getByText('Remote data is stale')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Remote target ready');
    expect(screen.queryByRole('button', { name: 'Terminal profiles' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'All sessions' }));
    expect(navigate).toHaveBeenCalledWith('sessions');
  });
});
