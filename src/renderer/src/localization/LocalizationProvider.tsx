import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState
} from 'react';

import type { LocalizationSnapshot, LumoraApi } from '../../../shared/contracts';
import englishErrors from '../../../../resources/locales/en/errors.json';
import {
  createLocalizationValue,
  LocalizationContext
} from './useLocalization';

export function LocalizationProvider({
  api,
  children
}: {
  api: LumoraApi;
  children: ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<LocalizationSnapshot | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const accept = (next: LocalizationSnapshot): void => {
      if (!active) return;
      setFailed(false);
      setSnapshot((current) =>
        current === null || next.revision >= current.revision ? next : current
      );
    };
    const unsubscribe = api.onLocalizationChanged(accept);
    void api.getLocalizationSnapshot().then(accept, () => {
      if (active) setFailed(true);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [api]);

  useLayoutEffect(() => {
    if (snapshot === null) return;
    document.documentElement.lang = snapshot.locale;
    document.documentElement.dir = snapshot.direction;
    document.documentElement.dataset.locale = snapshot.locale;
  }, [snapshot]);

  const value = useMemo(
    () => snapshot === null ? null : createLocalizationValue(snapshot),
    [snapshot]
  );

  if (failed && value === null) {
    return (
      <main className="window-bootstrap" role="alert">
        {englishErrors.localization.unavailable}
      </main>
    );
  }
  if (value === null) {
    return (
      <main
        aria-label={englishErrors.localization.opening}
        className="window-bootstrap"
        data-testid="localization-bootstrap"
      >
        <span className="window-bootstrap-indicator" />
      </main>
    );
  }
  return (
    <LocalizationContext.Provider value={value}>
      {children}
    </LocalizationContext.Provider>
  );
}
