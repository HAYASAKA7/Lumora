import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '../ui/Tooltip';
import { LumoraShell } from './LumoraShell';
import {
  renderWithLocalization,
  TEST_LOCALIZATION_SNAPSHOT
} from '../test/render-with-localization';

describe('LumoraShell', () => {
  it('renders scoped navigation and one application content region', () => {
    const navigate = vi.fn();
    renderWithLocalization(
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
            routes: [{
              id: 'settings', icon: 'settings', label: 'Settings',
              status: '1 computer online'
            }]
          }}
          sidebarContent={<section data-testid="sidebar-content">Session access</section>}
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
    const primary = document.querySelector('.primary-nav');
    const sidebarContent = screen.getByTestId('sidebar-content');
    const secondary = document.querySelector('.sidebar-remote-nav');
    expect(primary?.compareDocumentPosition(sidebarContent))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(sidebarContent.compareDocumentPosition(secondary!))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByRole('button', {
      name: 'Settings · 1 computer online'
    }).querySelector('.nav-status-dot')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'All sessions' }));
    expect(navigate).toHaveBeenCalledWith('sessions');
  });

  it('does not render expanded-only sidebar content while collapsed', () => {
    renderWithLocalization(
      <TooltipProvider>
        <LumoraShell
          activeRouteId="home"
          appearance={{
            backgroundActive: false,
            backgroundStyle: undefined,
            hasSurfaceMosaic: false,
            shellStyle: undefined,
            theme: 'lumora'
          }}
          main={<div />}
          onNavigate={vi.fn()}
          onToggleSidebar={vi.fn()}
          pageHeader={{ description: '', eyebrow: '', label: 'Home' }}
          primaryNavigation={{ label: 'Workspace', routes: [] }}
          sidebarContent={<section>Session access</section>}
          sidebarExpanded={false}
          statusBar={<footer />}
          topbar={{ context: '', kicker: '' }}
        />
      </TooltipProvider>
    );

    expect(screen.queryByText('Session access')).not.toBeInTheDocument();
  });

  it('translates shell-owned accessibility and brand text', () => {
    renderWithLocalization(
      <TooltipProvider>
        <LumoraShell
          activeRouteId="home"
          appearance={{
            backgroundActive: false,
            backgroundStyle: undefined,
            hasSurfaceMosaic: false,
            shellStyle: undefined,
            theme: 'lumora'
          }}
          main={<div />}
          onNavigate={vi.fn()}
          onToggleSidebar={vi.fn()}
          pageHeader={{ description: '', eyebrow: '', label: 'ホーム' }}
          primaryNavigation={{ label: 'ワークスペース', routes: [] }}
          sidebarExpanded={false}
          statusBar={<footer />}
          topbar={{ context: '', kicker: '' }}
        />
      </TooltipProvider>,
      {
        ...TEST_LOCALIZATION_SNAPSHOT,
        locale: 'ja',
        formattingLocale: 'ja',
        messages: {
          ...TEST_LOCALIZATION_SNAPSHOT.messages,
          'shell.sidebar.expand': 'サイドバーを展開',
          'shell.sidebar.skip-main': 'メインコンテンツへ移動',
          'shell.product.manager': 'エージェントワークスペース管理'
        }
      }
    );

    expect(screen.getByRole('button', { name: 'サイドバーを展開' })).toBeVisible();
    expect(screen.getByText('メインコンテンツへ移動')).toBeVisible();
    expect(screen.getByText('エージェントワークスペース管理')).toBeVisible();
  });
});
