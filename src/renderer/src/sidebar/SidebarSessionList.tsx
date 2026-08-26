import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type UIEvent
} from 'react';

import type { RuntimeSummary, SessionSummary } from '../../../shared/contracts';
import { providerDefinition } from '../../../shared/provider-definitions';
import { useProgressiveList } from '../catalog/progressive-list';
import { useLocalization } from '../localization/useLocalization';
import { OverflowTooltip } from '../ui/Tooltip';
import {
  readSidebarSessionSections,
  writeSidebarSessionSections,
  type SidebarSessionPreferenceHost,
  type SidebarSessionSections
} from './sidebar-session-preference';

interface SidebarSessionListProps {
  activeRuntimeId: string | null;
  onActivateRuntime(runtimeId: string): void;
  onResumeSession(session: SessionSummary): void;
  preferenceHost?: SidebarSessionPreferenceHost;
  preferenceScope: string;
  recent: readonly SessionSummary[];
  running: readonly RuntimeSummary[];
}

type ScrollingSection = 'running' | 'recent';

const RECENT_INITIAL_COUNT = 30;
const RECENT_BATCH_SIZE = 30;
const RECENT_LOAD_AHEAD_PX = 160;

function SectionToggle({
  expanded,
  label,
  onClick,
  toggleLabel
}: {
  expanded: boolean;
  label: string;
  onClick(): void;
  toggleLabel: string;
}): ReactNode {
  return (
    <button
      aria-expanded={expanded}
      aria-label={toggleLabel}
      className="sidebar-session-toggle"
      data-lumora-command
      onClick={onClick}
      tabIndex={-1}
      type="button"
    >
      <span>{label}</span>
      <span aria-hidden="true" className="sidebar-session-chevron">
        {expanded ? '⌄' : '›'}
      </span>
    </button>
  );
}

export function SidebarSessionList({
  activeRuntimeId,
  onActivateRuntime,
  onResumeSession,
  preferenceHost = window,
  preferenceScope,
  recent,
  running
}: SidebarSessionListProps): ReactNode {
  const { t } = useLocalization();
  const [sections, setSections] = useState<SidebarSessionSections>(() =>
    readSidebarSessionSections(preferenceHost, preferenceScope)
  );
  const [scrollingSection, setScrollingSection] =
    useState<ScrollingSection | null>(null);
  const scrollTimer = useRef<number | null>(null);
  const recentProgress = useProgressiveList({
    itemCount: recent.length,
    resetKey: preferenceScope,
    initialCount: RECENT_INITIAL_COUNT,
    batchSize: RECENT_BATCH_SIZE
  });

  useEffect(() => () => {
    if (scrollTimer.current !== null) {
      window.clearTimeout(scrollTimer.current);
    }
  }, []);

  const updateSections = (next: SidebarSessionSections) => {
    setSections(next);
    writeSidebarSessionSections(preferenceHost, preferenceScope, next);
  };

  const markScrolling = (
    section: ScrollingSection,
    event: UIEvent<HTMLDivElement>
  ) => {
    setScrollingSection(section);
    if (scrollTimer.current !== null) {
      window.clearTimeout(scrollTimer.current);
    }
    scrollTimer.current = window.setTimeout(() => {
      scrollTimer.current = null;
      setScrollingSection(null);
    }, 700);

    if (section === 'recent' && recentProgress.hasMore) {
      const { clientHeight, scrollHeight, scrollTop } = event.currentTarget;
      if (scrollHeight - scrollTop - clientHeight <= RECENT_LOAD_AHEAD_PX) {
        recentProgress.showMore();
      }
    }
  };

  const runningLabel = t('shell.sidebar.sessions.running');
  const recentLabel = t('shell.sidebar.sessions.recent');

  return (
    <div className="sidebar-session-region">
      {running.length === 0 ? null : (
        <section
          className="sidebar-session-section sidebar-session-section-running"
          data-expanded={sections.runningExpanded}
        >
          <SectionToggle
            expanded={sections.runningExpanded}
            label={runningLabel}
            onClick={() => updateSections({
              ...sections,
              runningExpanded: !sections.runningExpanded
            })}
            toggleLabel={t(
              sections.runningExpanded
                ? 'shell.sidebar.sessions.collapse-running'
                : 'shell.sidebar.sessions.expand-running'
            )}
          />
          {!sections.runningExpanded ? null : (
            <div
              aria-label={runningLabel}
              className={`sidebar-session-items${
                scrollingSection === 'running' ? ' is-scrolling' : ''
              }`}
              onScroll={(event) => markScrolling('running', event)}
              role="region"
            >
              {running.map((runtime) => (
                <button
                  aria-current={runtime.id === activeRuntimeId ? 'true' : undefined}
                  className="sidebar-session-item"
                  data-lumora-command
                  key={runtime.id}
                  onClick={() => onActivateRuntime(runtime.id)}
                  tabIndex={-1}
                  type="button"
                >
                  <span aria-hidden="true" className="sidebar-session-running-dot" />
                  <span className="sidebar-session-copy">
                    <OverflowTooltip content={runtime.displayName}>
                      <span className="sidebar-session-title">
                        {runtime.displayName}
                      </span>
                    </OverflowTooltip>
                    <small>{providerDefinition(runtime.provider).displayName}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {recent.length === 0 ? null : (
        <section
          className="sidebar-session-section sidebar-session-section-recent"
          data-expanded={sections.recentExpanded}
        >
          <SectionToggle
            expanded={sections.recentExpanded}
            label={recentLabel}
            onClick={() => updateSections({
              ...sections,
              recentExpanded: !sections.recentExpanded
            })}
            toggleLabel={t(
              sections.recentExpanded
                ? 'shell.sidebar.sessions.collapse-recent'
                : 'shell.sidebar.sessions.expand-recent'
            )}
          />
          {!sections.recentExpanded ? null : (
            <div
              aria-label={recentLabel}
              className={`sidebar-session-items${
                scrollingSection === 'recent' ? ' is-scrolling' : ''
              }`}
              onScroll={(event) => markScrolling('recent', event)}
              role="region"
            >
              {recent.slice(0, recentProgress.visibleCount).map((session) => (
                <button
                  className="sidebar-session-item"
                  data-lumora-command
                  key={session.id}
                  onClick={() => onResumeSession(session)}
                  tabIndex={-1}
                  type="button"
                >
                  <span className="sidebar-session-copy">
                    <OverflowTooltip content={session.title}>
                      <span className="sidebar-session-title">
                        {session.title}
                      </span>
                    </OverflowTooltip>
                    <small>{providerDefinition(session.provider).displayName}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
