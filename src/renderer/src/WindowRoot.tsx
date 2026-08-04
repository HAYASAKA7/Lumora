import { useEffect, useState } from 'react';

import type { LumoraApi, LumoraWindowContext } from '../../shared/contracts';
import App from './App';
import { RemoteTargetWindow } from './remote/RemoteTargetWindow';

export function WindowRoot({ api = window.lumora }: { api?: LumoraApi }) {
  const [context, setContext] = useState<LumoraWindowContext | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void api.getWindowContext().then(
      (value) => { if (active) setContext(value); },
      () => { if (active) setFailed(true); }
    );
    return () => { active = false; };
  }, [api]);

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
  return context.mode === 'local'
    ? <App />
    : (
        <RemoteTargetWindow
          api={api}
          executionTargetId={context.executionTargetId}
        />
      );
}
