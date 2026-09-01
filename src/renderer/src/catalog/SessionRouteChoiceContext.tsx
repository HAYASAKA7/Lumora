import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';

import {
  STRUCTURED_AGENT_PROVIDER_IDS,
  type LumoraApi,
  type ProviderId,
  type StructuredAgentProviderId,
  type StructuredProviderCapabilityReport,
  type StructuredProviderPreference
} from '../../../shared/contracts';

export const STRUCTURED_PREFERENCES_CHANGED_EVENT =
  'lumora:structured-preferences-changed';

type RouteChoiceApi = Pick<
  LumoraApi,
  'getStructuredProviderPreferences'
  | 'scanStructuredProviderCapabilities'
> & Partial<Pick<
  LumoraApi,
  'getGeneralSettings' | 'onGeneralSettingsChanged'
>>;

type UnavailableReason =
  | 'unavailable'
  | 'incompatible'
  | 'failed'
  | 'timed_out'
  | 'resume_unsupported';

export type SessionUnifiedRouteChoice =
  | { visibility: 'hidden'; resolve(): void }
  | {
      visibility: 'visible';
      state: 'checking' | 'available';
      resolve(): void;
    }
  | {
      visibility: 'visible';
      state: 'unavailable';
      reason: UnavailableReason;
      resolve(): void;
    };

interface RouteChoiceContextValue {
  unifiedAgentUiEnabled: boolean | null;
  preferences: readonly StructuredProviderPreference[] | null;
  reports: readonly StructuredProviderCapabilityReport[] | null;
  scanFailed: boolean;
  resolve(): void;
}

const RouteChoiceContext = createContext<RouteChoiceContextValue | null>(null);
const doNothing = () => undefined;
const hiddenChoice: SessionUnifiedRouteChoice = {
  visibility: 'hidden',
  resolve: doNothing
};

function isStructuredProvider(
  provider: ProviderId
): provider is StructuredAgentProviderId {
  return STRUCTURED_AGENT_PROVIDER_IDS.some((candidate) => candidate === provider);
}

export function SessionRouteChoiceProvider({
  api,
  children
}: {
  api: RouteChoiceApi;
  children: ReactNode;
}): ReactNode {
  const [preferences, setPreferences] = useState<
    readonly StructuredProviderPreference[] | null
  >(null);
  const [unifiedAgentUiEnabled, setUnifiedAgentUiEnabled] = useState<
    boolean | null
  >(null);
  const [reports, setReports] = useState<
    readonly StructuredProviderCapabilityReport[] | null
  >(null);
  const [scanFailed, setScanFailed] = useState(false);
  const scanPromise = useRef<Promise<void> | null>(null);

  const refreshPreferences = useCallback(() => {
    setReports(null);
    setScanFailed(false);
    scanPromise.current = null;
    void api.getStructuredProviderPreferences().then(
      setPreferences,
      () => setPreferences([])
    );
  }, [api]);

  const refreshGeneralSettings = useCallback(() => {
    if (api.getGeneralSettings === undefined) {
      setUnifiedAgentUiEnabled(true);
      return;
    }
    void api.getGeneralSettings().then(
      (settings) => {
        setUnifiedAgentUiEnabled(settings.unifiedAgentUiEnabled);
        if (!settings.unifiedAgentUiEnabled) {
          setReports(null);
          setScanFailed(false);
          scanPromise.current = null;
        }
      },
      () => setUnifiedAgentUiEnabled(false)
    );
  }, [api]);

  useEffect(() => {
    refreshPreferences();
    refreshGeneralSettings();
    window.addEventListener(
      STRUCTURED_PREFERENCES_CHANGED_EVENT,
      refreshPreferences
    );
    const unsubscribe = api.onGeneralSettingsChanged?.(
      refreshGeneralSettings
    );
    return () => {
      window.removeEventListener(
        STRUCTURED_PREFERENCES_CHANGED_EVENT,
        refreshPreferences
      );
      unsubscribe?.();
    };
  }, [api, refreshGeneralSettings, refreshPreferences]);

  const resolve = useCallback(() => {
    if (
      unifiedAgentUiEnabled !== true ||
      reports !== null ||
      scanPromise.current !== null
    ) return;
    setScanFailed(false);
    const pending = api.scanStructuredProviderCapabilities(false).then(
      (nextReports) => setReports(nextReports),
      () => setScanFailed(true)
    ).finally(() => {
      if (scanPromise.current === pending) scanPromise.current = null;
    });
    scanPromise.current = pending;
  }, [api, reports, unifiedAgentUiEnabled]);

  const value = useMemo(() => ({
    preferences,
    reports,
    resolve,
    scanFailed,
    unifiedAgentUiEnabled
  }), [preferences, reports, resolve, scanFailed, unifiedAgentUiEnabled]);

  return (
    <RouteChoiceContext.Provider value={value}>
      {children}
    </RouteChoiceContext.Provider>
  );
}

export function useSessionRouteChoice(
  provider: ProviderId
): SessionUnifiedRouteChoice {
  const context = useContext(RouteChoiceContext);
  if (context === null || !isStructuredProvider(provider)) return hiddenChoice;
  if (context.unifiedAgentUiEnabled !== true) return hiddenChoice;
  const preference = context.preferences?.find(
    (candidate) => candidate.providerId === provider
  );
  if (preference?.useUnifiedWhenAvailable !== true) return hiddenChoice;
  if (context.scanFailed) {
    return {
      visibility: 'visible',
      state: 'unavailable',
      reason: 'failed',
      resolve: context.resolve
    };
  }
  if (context.reports === null) {
    return {
      visibility: 'visible',
      state: 'checking',
      resolve: context.resolve
    };
  }
  const report = context.reports.find(
    (candidate) => candidate.providerId === provider
  );
  if (report === undefined) {
    return {
      visibility: 'visible',
      state: 'unavailable',
      reason: 'unavailable',
      resolve: context.resolve
    };
  }
  if (report.state !== 'verified') {
    return {
      visibility: 'visible',
      state: 'unavailable',
      reason: report.state,
      resolve: context.resolve
    };
  }
  if (!report.capabilities.resumeSession) {
    return {
      visibility: 'visible',
      state: 'unavailable',
      reason: 'resume_unsupported',
      resolve: context.resolve
    };
  }
  return {
    visibility: 'visible',
    state: 'available',
    resolve: context.resolve
  };
}
