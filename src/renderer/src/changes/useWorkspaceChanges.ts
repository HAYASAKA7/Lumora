import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  ChangesFileDiff,
  ChangesSource,
  ChangesSummary,
  LumoraApi
} from '../../../shared/contracts';

export type ChangesApi = Pick<
  LumoraApi,
  | 'getChangesSummary'
  | 'getChangesFileDiff'
  | 'markChangesReviewed'
  | 'getChangedFilePath'
  | 'openChangedFile'
  | 'onChangesCount'
  | 'writeClipboardText'
  | 'getChangesHistory'
>;

export type Load<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'error' };

export interface WorkspaceChanges {
  summary: Load<ChangesSummary>;
  /** True while a reload runs over a summary that is already shown. */
  refreshing: boolean;
  selectedPath: string | null;
  setSelectedPath(path: string | null): void;
  /** Null when nothing is selected. */
  diff: Load<ChangesFileDiff> | null;
  /** Reloads the summary; calls made while one is in flight share one follow-up load. */
  reload(): Promise<void>;
  /**
   * Marks paths reviewed for a session source in its session view and stores
   * the returned summary; a no-op for other sources and views. Rejects when the API call fails, leaving the
   * state unchanged.
   */
  markReviewed(paths: readonly string[]): Promise<void>;
}

const LOADING: Load<never> = { state: 'loading' };

/** How long a new selection must stay put before its diff is fetched. */
export const DIFF_SELECTION_DELAY_MS = 150;

interface DiffEntry {
  source: ChangesSource;
  path: string;
  load: Load<ChangesFileDiff>;
}

interface InFlightReload {
  epoch: number;
  promise: Promise<void>;
  again: boolean;
}

function listsPath(summary: ChangesSummary, path: string): boolean {
  return summary.files.some((file) => file.path === path) ||
    summary.committed.some((file) => file.path === path);
}

function sameDiff(load: Load<ChangesFileDiff>, value: ChangesFileDiff): boolean {
  return load.state === 'ready' &&
    load.value.patch === value.patch &&
    load.value.binary === value.binary &&
    load.value.truncated === value.truncated;
}

export function useWorkspaceChanges(
  api: ChangesApi,
  source: ChangesSource,
  active: boolean
): WorkspaceChanges {
  const sourceKey = JSON.stringify(source);
  // The caller may rebuild an equal source on every render; follow its value only.
  const stableSource = useMemo<ChangesSource>(() => JSON.parse(sourceKey) as ChangesSource, [sourceKey]);

  const apiRef = useRef(api);
  apiRef.current = api;

  const [trackedKey, setTrackedKey] = useState(sourceKey);
  const [summary, setSummary] = useState<Load<ChangesSummary>>(LOADING);
  const [reloading, setReloading] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [diffEntry, setDiffEntry] = useState<DiffEntry | null>(null);
  /** Bumped whenever a summary lands, so the open diff is fetched again. */
  const [summaryRevision, setSummaryRevision] = useState(0);
  /** Changes when the source or activity changes; older responses must not land. */
  const epoch = useRef(0);
  /** Counts stored summaries, so a response that started before a newer one is dropped. */
  const storedSummaries = useRef(0);
  const inFlight = useRef<InFlightReload | null>(null);
  /** The last diff actually requested, so a refresh of the same file skips the selection delay. */
  const lastDiffRequest = useRef<{ source: ChangesSource; path: string } | null>(null);

  if (trackedKey !== sourceKey) {
    // Reset during render so no effect runs against the previous source's selection.
    setTrackedKey(sourceKey);
    setSummary(LOADING);
    setReloading(false);
    setSelectedPath(null);
    setDiffEntry(null);
  }

  const storeSummary = useCallback((value: ChangesSummary, reviewed: readonly string[] = []) => {
    storedSummaries.current += 1;
    setSummary({ state: 'ready', value });
    setSummaryRevision((revision) => revision + 1);
    setSelectedPath((current) =>
      current !== null && (reviewed.includes(current) || !listsPath(value, current)) ? null : current
    );
  }, []);

  const reload = useCallback((): Promise<void> => {
    if (!active) return Promise.resolve();
    const current = inFlight.current;
    if (current !== null && current.epoch === epoch.current) {
      current.again = true;
      return current.promise;
    }
    const entry: InFlightReload = { epoch: epoch.current, promise: Promise.resolve(), again: false };
    const isCurrent = () => entry.epoch === epoch.current;
    const run = async (): Promise<void> => {
      setReloading(true);
      try {
        do {
          entry.again = false;
          const storedBefore = storedSummaries.current;
          try {
            const value = await apiRef.current.getChangesSummary(stableSource);
            if (isCurrent() && storedBefore === storedSummaries.current) storeSummary(value);
          } catch {
            if (isCurrent() && storedBefore === storedSummaries.current) setSummary({ state: 'error' });
          }
        } while (entry.again && isCurrent());
      } finally {
        if (inFlight.current === entry) inFlight.current = null;
        if (isCurrent()) setReloading(false);
      }
    };
    entry.promise = run();
    inFlight.current = entry;
    return entry.promise;
  }, [active, stableSource, storeSummary]);

  useEffect(() => {
    if (!active) return undefined;
    void reload();
    return () => {
      epoch.current += 1;
      setReloading(false);
    };
  }, [active, reload]);

  useEffect(() => {
    // A review is a finished batch; a session follows its own owner and a workspace every session in it.
    if (!active || stableSource.kind === 'review') return undefined;
    const source = stableSource;
    return apiRef.current.onChangesCount((count) => {
      const mine = source.kind === 'session'
        ? count.ownerId === source.ownerId
        : count.workspaceId === source.workspaceId;
      if (mine) void reload();
    });
  }, [active, stableSource, reload]);

  useEffect(() => {
    if (!active || selectedPath === null) return undefined;
    let cancelled = false;
    const path = selectedPath;
    const store = (load: Load<ChangesFileDiff>, value?: ChangesFileDiff) => {
      if (cancelled) return;
      setDiffEntry((current) =>
        value !== undefined && current !== null && current.source === stableSource &&
          current.path === path && sameDiff(current.load, value)
          ? current
          : { source: stableSource, path, load }
      );
    };
    const fetchDiff = () => {
      lastDiffRequest.current = { source: stableSource, path };
      apiRef.current.getChangesFileDiff(stableSource, path).then(
        (value) => store({ state: 'ready', value }, value),
        () => store({ state: 'error' })
      );
    };
    const previous = lastDiffRequest.current;
    // Refreshing the open file answers at once; a new selection waits so arrowing through files fetches once.
    const refresh = previous !== null && previous.source === stableSource && previous.path === path;
    const timer = refresh ? null : setTimeout(fetchDiff, DIFF_SELECTION_DELAY_MS);
    if (refresh) fetchDiff();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [active, selectedPath, stableSource, summaryRevision]);

  const markReviewed = useCallback(async (paths: readonly string[]): Promise<void> => {
    if (stableSource.kind !== 'session' || stableSource.view !== 'session' || paths.length === 0) return;
    const epochBefore = epoch.current;
    const storedBefore = storedSummaries.current;
    const value = await apiRef.current.markChangesReviewed(stableSource.ownerId, paths);
    if (epochBefore !== epoch.current) return;
    if (storedBefore !== storedSummaries.current) {
      // A summary landed meanwhile; fetch again rather than guess which is newer.
      void reload();
      return;
    }
    storeSummary(value, paths);
  }, [reload, stableSource, storeSummary]);

  let diff: Load<ChangesFileDiff> | null = null;
  if (selectedPath !== null) {
    diff = diffEntry !== null && diffEntry.source === stableSource && diffEntry.path === selectedPath
      ? diffEntry.load
      : LOADING;
  }

  return {
    summary,
    refreshing: reloading && summary.state === 'ready',
    selectedPath,
    setSelectedPath,
    diff,
    reload,
    markReviewed
  };
}
