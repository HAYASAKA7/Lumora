import type {
  CSSProperties,
  ReactNode,
  Ref
} from 'react';

import lumoraBrandMarkUrl from '../../../../resources/icons/lumora/source/lumora-symbol-gradient.svg';
import type { AppearanceSettings } from '../../../shared/contracts';
import { useLocalization } from '../localization/useLocalization';
import { Tooltip } from '../ui/Tooltip';

export type NavigationIconName =
  | 'home'
  | 'workspace'
  | 'sessions'
  | 'terminal'
  | 'remote'
  | 'settings'
  | 'activity'
  | 'attention'
  | 'history'
  | 'scan';

export interface ShellRoute<RouteId extends string = string> {
  id: RouteId;
  icon: NavigationIconName;
  label: string;
  shortcut?: string | undefined;
  status?: string | undefined;
}

export interface ShellNavigationGroup<RouteId extends string = string> {
  ariaLabel?: string;
  label: string;
  routes: readonly ShellRoute<RouteId>[];
}

export interface LumoraShellAppearance {
  backgroundActive: boolean;
  backgroundStyle: CSSProperties | undefined;
  hasSurfaceMosaic: boolean;
  shellStyle: CSSProperties | undefined;
  theme: AppearanceSettings['theme'];
}

interface LumoraShellProps<RouteId extends string = string> {
  activeRouteId: RouteId;
  appearance: LumoraShellAppearance;
  ariaHidden?: boolean | undefined;
  banner?: ReactNode;
  className?: string;
  floatingContent?: ReactNode;
  hidePageHeader?: boolean;
  main: ReactNode;
  mainClassName?: string;
  mainRef?: Ref<HTMLElement>;
  navigationActive?: boolean;
  onNavigate(routeId: RouteId): void;
  onToggleSidebar(): void;
  pageHeader: {
    description: string;
    eyebrow: string;
    label: string;
  };
  primaryNavigation: ShellNavigationGroup<RouteId>;
  secondaryNavigation?: ShellNavigationGroup<RouteId> | undefined;
  sidebarExpanded: boolean;
  sidebarToggleShortcut?: string | undefined;
  statusBar: ReactNode;
  topbar: {
    actions?: ReactNode;
    context: string;
    kicker: string;
  };
}

export function NavigationIcon({
  name
}: {
  name: NavigationIconName;
}): ReactNode {
  const paths: Record<NavigationIconName, ReactNode> = {
    home: <path d="M3.5 9.3 10 3.8l6.5 5.5v7.2a1 1 0 0 1-1 1h-4v-5h-3v5h-4a1 1 0 0 1-1-1Z" />,
    workspace: <path d="M2.5 5.5h5l1.5 2h8.5v8a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5Zm0 2h15" />,
    sessions: <path d="M5 4.5h10M5 10h10M5 15.5h7M2.5 4.5h.1M2.5 10h.1M2.5 15.5h.1" />,
    terminal: <path d="m4 6 3.5 4L4 14m6 0h6" />,
    remote: <path d="M3 5.5h14v9H3Zm3 12h8M10 14.5v3M6.5 9.5h7" />,
    settings: <path d="M10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm6.2 3a6 6 0 0 0-.1-1l1.6-1.3-1.8-3.1-2 .8a7 7 0 0 0-1.8-1L11.8 2H8.2l-.3 2.4a7 7 0 0 0-1.8 1l-2-.8-1.8 3.1L3.9 9a6 6 0 0 0 0 2l-1.6 1.3 1.8 3.1 2-.8a7 7 0 0 0 1.8 1l.3 2.4h3.6l.3-2.4a7 7 0 0 0 1.8-1l2 .8 1.8-3.1-1.6-1.3a6 6 0 0 0 .1-1Z" />,
    activity: <path d="M2 11h3l2-5 3.2 9 2.2-6 1.4 2H18" />,
    attention: <path d="M10 3 2.8 16h14.4Zm0 5v3.5m0 2.5v.1" />,
    history: <path d="M4.2 6.4A7 7 0 1 1 3 12m0-5.5v4h4M10 6v4l2.8 1.8" />,
    scan: <path d="M3 7V4a1 1 0 0 1 1-1h3m6 0h3a1 1 0 0 1 1 1v3m0 6v3a1 1 0 0 1-1 1h-3m-6 0H4a1 1 0 0 1-1-1v-3M6 10h8" />
  };

  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      viewBox="0 0 20 20"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.55"
    >
      {paths[name]}
    </svg>
  );
}

function NavigationGroup<RouteId extends string>({
  activeRouteId,
  expanded,
  group,
  onNavigate,
  primary
}: {
  activeRouteId: RouteId | null;
  expanded: boolean;
  group: ShellNavigationGroup<RouteId>;
  onNavigate(routeId: RouteId): void;
  primary: boolean;
}): ReactNode {
  const { t } = useLocalization();
  return (
    <nav
      aria-label={group.ariaLabel ?? group.label}
      className={primary ? 'primary-nav' : 'sidebar-remote-nav'}
    >
      {primary ? (
        <p className="nav-label">
          <span className="nav-label-text">{group.label}</span>
          <span aria-hidden="true" className="nav-label-divider" />
        </p>
      ) : null}
      {group.routes.map((route) => (
        <Tooltip
          content={expanded
            ? null
            : route.status === undefined
              ? route.label
              : `${route.label} (${route.status})`}
          key={route.id}
          shortcut={route.shortcut}
        >
          <button
            aria-label={route.status === undefined
              ? undefined
              : t('shell.sidebar.route-status', {
                  route: route.label,
                  status: route.status
                })}
            aria-current={activeRouteId === route.id ? 'page' : undefined}
            className="nav-item"
            data-lumora-command
            onClick={() => onNavigate(route.id)}
            tabIndex={-1}
            type="button"
          >
            <span className="nav-item-icon">
              <NavigationIcon name={route.icon} />
              {route.status === undefined ? null : (
                <span aria-hidden="true" className="nav-status-dot" />
              )}
            </span>
            <span className="nav-item-label">{route.label}</span>
          </button>
        </Tooltip>
      ))}
    </nav>
  );
}

export function LumoraShell<RouteId extends string>({
  activeRouteId,
  appearance,
  ariaHidden,
  banner,
  className = '',
  floatingContent,
  hidePageHeader = false,
  main,
  mainClassName = '',
  mainRef,
  onNavigate,
  onToggleSidebar,
  navigationActive = true,
  pageHeader,
  primaryNavigation,
  secondaryNavigation,
  sidebarExpanded,
  sidebarToggleShortcut,
  statusBar,
  topbar
}: LumoraShellProps<RouteId>): ReactNode {
  const { t } = useLocalization();
  const toggleLabel = sidebarExpanded
    ? t('shell.sidebar.collapse')
    : t('shell.sidebar.expand');
  const shellClassName = [
    'appearance-root',
    'app-shell',
    sidebarExpanded ? '' : 'sidebar-collapsed',
    appearance.backgroundActive ? 'has-appearance-background' : '',
    appearance.hasSurfaceMosaic ? 'has-surface-mosaic' : '',
    className
  ].filter(Boolean).join(' ');

  return (
    <div
      aria-hidden={ariaHidden}
      className={shellClassName}
      data-testid="lumora-shell"
      data-theme={appearance.theme}
      style={appearance.shellStyle}
    >
      {appearance.backgroundStyle === undefined ? null : (
        <div
          aria-hidden="true"
          className="appearance-background-layer"
          style={appearance.backgroundStyle}
        />
      )}
      <a className="skip-link" href="#main-content">{t('shell.sidebar.skip-main')}</a>

      <aside className="sidebar">
        <Tooltip
          content={sidebarExpanded ? null : toggleLabel}
          shortcut={sidebarToggleShortcut}
        >
          <button
            aria-expanded={sidebarExpanded}
            aria-label={toggleLabel}
            className="brand"
            data-lumora-command
            onClick={onToggleSidebar}
            tabIndex={-1}
            type="button"
          >
            <img alt="" className="brand-mark" src={lumoraBrandMarkUrl} />
            <span className="brand-copy">
              <strong>{t('shell.product.name')}</strong>
              <small>{t('shell.product.manager')}</small>
            </span>
          </button>
        </Tooltip>

        <NavigationGroup
          activeRouteId={navigationActive ? activeRouteId : null}
          expanded={sidebarExpanded}
          group={primaryNavigation}
          onNavigate={onNavigate}
          primary
        />
        {secondaryNavigation === undefined ? null : (
          <NavigationGroup
            activeRouteId={navigationActive ? activeRouteId : null}
            expanded={sidebarExpanded}
            group={secondaryNavigation}
            onNavigate={onNavigate}
            primary={false}
          />
        )}
      </aside>

      <div className="workspace-frame">
        <header className="topbar">
          <div>
            <p className="topbar-kicker">{topbar.kicker}</p>
            <p className="topbar-context">{topbar.context}</p>
          </div>
          <div aria-label={t('shell.topbar.session-actions')} className="topbar-actions" role="group">
            {topbar.actions}
          </div>
        </header>

        <main
          className={`main-content${mainClassName ? ` ${mainClassName}` : ''}`}
          id="main-content"
          ref={mainRef}
          tabIndex={-1}
        >
          {banner}
          {hidePageHeader ? null : (
            <header className="page-header">
              <p className="eyebrow">{pageHeader.eyebrow}</p>
              <h1>{pageHeader.label}</h1>
              <p className="page-description">{pageHeader.description}</p>
            </header>
          )}
          {main}
        </main>

        {statusBar}
      </div>
      {floatingContent}
    </div>
  );
}
