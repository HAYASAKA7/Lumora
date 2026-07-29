import { useCallback, useMemo, useState } from 'react';

import type {
  ProviderId,
  ProviderScanResult,
  SessionSummary,
  SessionTransferCapability
} from '../../../shared/contracts';

interface UseSessionExportSelectionInput {
  sessions: readonly SessionSummary[];
  providerScan: ProviderScanResult | null;
  runningSessionIds: ReadonlySet<string>;
  loadCapabilities(): Promise<SessionTransferCapability[]>;
}

export function useSessionExportSelection({
  loadCapabilities,
  providerScan,
  runningSessionIds,
  sessions
}: UseSessionExportSelectionInput) {
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [capabilities, setCapabilities] =
    useState<SessionTransferCapability[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  const begin = useCallback(async () => {
    setActive(true);
    setLoading(true);
    setError(null);
    try {
      setCapabilities(await loadCapabilities());
    } catch {
      setCapabilities([]);
      setError('Export support could not be checked.');
    } finally {
      setLoading(false);
    }
  }, [loadCapabilities]);

  const close = useCallback(() => {
    setActive(false);
    setLoading(false);
    setCapabilities(null);
    setSelected(new Set());
    setError(null);
  }, []);

  const disabledReason = useCallback(
    (session: SessionSummary): string | null => {
      if (loading || capabilities === null) {
        return 'Checking provider export support.';
      }
      if (runningSessionIds.has(session.id)) {
        return 'Running sessions cannot be exported.';
      }
      if (session.sourceFreshness !== 'current') {
        return 'Stale session sources cannot be exported.';
      }
      const installation = providerScan?.providers.find(
        (provider) => provider.provider === session.provider
      );
      if (installation?.state !== 'ready') {
        return 'The provider is unavailable.';
      }
      const capability = capabilities.find(
        (candidate) => candidate.provider === session.provider
      );
      if (capability?.exportSupport !== 'supported') {
        return 'This provider export route is not verified.';
      }
      return null;
    },
    [capabilities, loading, providerScan, runningSessionIds]
  );

  const toggleSession = useCallback(
    (session: SessionSummary) => {
      if (disabledReason(session) !== null) return;
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(session.id)) next.delete(session.id);
        else next.add(session.id);
        return next;
      });
    },
    [disabledReason]
  );

  const eligibleByProvider = useMemo(() => {
    const grouped = new Map<ProviderId, SessionSummary[]>();
    for (const session of sessions) {
      if (disabledReason(session) !== null) continue;
      const group = grouped.get(session.provider) ?? [];
      group.push(session);
      grouped.set(session.provider, group);
    }
    return grouped;
  }, [disabledReason, sessions]);

  const toggleProvider = useCallback(
    (provider: ProviderId) => {
      const eligible = eligibleByProvider.get(provider) ?? [];
      if (eligible.length === 0) return;
      setSelected((current) => {
        const next = new Set(current);
        const everySelected = eligible.every((session) => next.has(session.id));
        for (const session of eligible) {
          if (everySelected) next.delete(session.id);
          else next.add(session.id);
        }
        return next;
      });
    },
    [eligibleByProvider]
  );

  return {
    active,
    begin,
    close,
    disabledReason,
    eligibleByProvider,
    error,
    loading,
    selected,
    toggleProvider,
    toggleSession
  };
}
