import { useCallback, useMemo, useState } from 'react';

import type {
  ProviderId,
  ProviderScanResult,
  SessionSummary,
  SessionTransferCapability
} from '../../../shared/contracts';

interface UseSessionExportSelectionInput {
  capabilities: readonly SessionTransferCapability[];
  sessions: readonly SessionSummary[];
  providerScan: ProviderScanResult | null;
  runningSessionIds: ReadonlySet<string>;
}

export function useSessionExportSelection({
  capabilities,
  providerScan,
  runningSessionIds,
  sessions
}: UseSessionExportSelectionInput) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const clear = useCallback(() => setSelected(new Set()), []);

  const disabledReason = useCallback(
    (session: SessionSummary): string | null => {
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
    [capabilities, providerScan, runningSessionIds]
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
    clear,
    disabledReason,
    eligibleByProvider,
    selected,
    toggleProvider,
    toggleSession
  };
}