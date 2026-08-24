import { useCallback, useEffect, useLayoutEffect, useState } from 'react';

import type {
  AppearancePresentation,
  LumoraApi,
  LumoraWindowContext
} from '../../shared/contracts';
import App from './App';
import { buildAppearancePresentation } from './appearance/presentation';
import { installAppFocusPolicy } from './focus/app-focus-policy';
import { LocalizationProvider } from './localization/LocalizationProvider';
import { RemoteTargetWindow } from './remote/RemoteTargetWindow';

export function WindowRoot({ api = window.lumora }: { api?: LumoraApi }) {
  useEffect(() => installAppFocusPolicy(document), []);
  return (
    <LocalizationProvider api={api}>
      <WindowContent api={api} />
    </LocalizationProvider>
  );
}

function WindowContent({ api }: { api: LumoraApi }) {
  const [context, setContext] = useState<LumoraWindowContext | null>(null);
  const [appearance, setAppearance] = useState<AppearancePresentation | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void api.getWindowContext().then(
      async (value) => {
        if (!active) return;
        setContext(value);
        if (value.mode === 'remote') {
          try {
            const presentation = await api.getAppearancePresentation();
            if (active) setAppearance(presentation);
          } catch {
            if (active) setFailed(true);
          }
        }
      },
      () => { if (active) setFailed(true); }
    );
    return () => { active = false; };
  }, [api]);

  const refreshRemoteAppearance = useCallback(() => {
    if (context?.mode !== 'remote') return;
    void api.getAppearancePresentation().then(
      setAppearance,
      () => undefined
    );
  }, [api, context]);

  useEffect(() => {
    if (context?.mode !== 'remote') return;
    window.addEventListener('focus', refreshRemoteAppearance);
    return () => window.removeEventListener('focus', refreshRemoteAppearance);
  }, [context, refreshRemoteAppearance]);

  useLayoutEffect(() => {
    if (context?.mode !== 'remote' || appearance === null) return;
    const theme = appearance.appearance.theme;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
  }, [appearance, context]);

  if (failed) {
    return (
      <main className="remote-window-shell">
        <section className="remote-window-card">
          <p className="eyebrow">Lumora</p>
          <h1>Window authorization failed</h1>
          <p>Close this window and open Lumora again.</p>
        </section>
      </main>
    );
  }
  if (context === null) {
    return (
      <main className="window-bootstrap" aria-label="Opening Lumora">
        <span className="window-bootstrap-indicator" />
      </main>
    );
  }
  if (context.mode === 'local') return <App />;
  if (appearance === null) {
    return (
      <main className="window-bootstrap" aria-label="Opening Lumora">
        <span className="window-bootstrap-indicator" />
      </main>
    );
  }

  const presentation = buildAppearancePresentation(
    appearance.appearance,
    appearance.background
  );
  return (
    <div
      className={`appearance-root remote-window-root${presentation.backgroundActive ? ' has-appearance-background' : ''}${presentation.hasSurfaceMosaic ? ' has-surface-mosaic' : ''}`}
      data-testid="remote-appearance-root"
      data-theme={appearance.appearance.theme}
      style={presentation.shellStyle}
    >
      {presentation.backgroundStyle === undefined ? null : (
        <div
          aria-hidden="true"
          className="appearance-background-layer"
          style={presentation.backgroundStyle}
        />
      )}
        <RemoteTargetWindow
          appearance={{
            backgroundActive: presentation.backgroundActive,
            backgroundStyle: undefined,
            hasSurfaceMosaic: presentation.hasSurfaceMosaic,
            shellStyle: presentation.shellStyle,
            theme: appearance.appearance.theme
          }}
          api={api}
          executionTargetId={context.executionTargetId}
        />
    </div>
  );
}
