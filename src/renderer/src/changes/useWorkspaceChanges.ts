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
  | 'openChangedFile'
  | 'onChangesCount'
  | 'writeClipboardText'
  | 'getChangesHistory'
>;

export type Load<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'error' };

export interface WorkspaceChanges {
  summary: Load<ChangesSummary>;
  selectedPath: string | null;
  setSelectedPath(path: string | null): void;
  /** Null when nothing is selected. */
  diff: Load<ChangesFileDiff> | null;
  reload(): Promise<void>;
  /** Session sources only; a no-op for other sources. */
  markReviewed(paths: readonly string[]): Promise<void>;
}

const LOADING: Load<never> = { state: 'loading' };

interface DiffEntry {
  source: string;
  path: string;
  load: Load<ChangesFileDiff>;
}

function listsPath(summary: ChangesSummary, path: string): boolean {
  return summary.files.some((file) => file.path === path) ||
    summary.committed.some((file) => file.path === path);
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
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [diffEntry, setDiffEntry] = useState<DiffEntry | null>(null);
  /** Bumped whenever a summary lands, so the open diff is fetched again. */
  const [summaryRevision, setSummaryRevision] = useState(0);
  const generation = useRef(0);

  if (trackedKey !== sourceKey) {
    // Reset during render so no effect runs against the previous source's selection.
    setTrackedKey(sourceKey);
    setSummary(LOADING);
    setSelectedPath(null);
    setDiffEntry(null);
  }

  const storeSummary = useCallback((value: ChangesSummary, reviewed: readonly string[] = []) => {
    setSummary({ state: 'ready', value });
    setSummaryRevision((revision) => revision + 1);
    setSelectedPath((current) =>
      current !== null && (reviewed.includes(current) || !listsPath(value, current)) ? null : current
    );
  }, []);

  const reload = useCallback(async (): Promise<void> => {
    if (!active) return;
    generation.current += 1;
    const requested = generation.current;
    try {
      const value = await apiRef.current.getChangesSummary(stableSource);
      if (requested === generation.current) storeSummary(value);
    } catch {
      if (requested === generation.current) setSummary({ state: 'error' });
    }
  }, [active, stableSource, storeSummary]);

  useEffect(() => {
    if (!active) return undefined;
    void reload();
    return () => {
      // Responses for a source or activity that is gone must not land.
      generation.current += 1;
    };
  }, [active, reload]);

  useEffect(() => {
    if (!active || stableSource.kind !== 'session') return undefined;
    const ownerId = stableSource.ownerId;
    return apiRef.current.onChangesCount((count) => {
      if (count.ownerId === ownerId) void reload();
    });
  }, [active, stableSource, reload]);

  useEffect(() => {
    if (!active || selectedPath === null) return undefined;
    let cancelled = false;
    const path = selectedPath;
    // Keep showing the current diff for this file while a refreshed one loads.
    setDiffEntry((current) =>
      current !== null && current.source === sourceKey && current.path === path
        ? current
        : { source: sourceKey, path, load: LOADING }
    );
    apiRef.current.getChangesFileDiff(stableSource, path).then(
      (value) => {
        if (!cancelled) setDiffEntry({ source: sourceKey, path, load: { state: 'ready', value } });
      },
      () => {
        if (!cancelled) setDiffEntry({ source: sourceKey, path, load: { state: 'error' } });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [active, selectedPath, sourceKey, stableSource, summaryRevision]);

  const markReviewed = useCallback(async (paths: readonly string[]): Promise<void> => {
    if (stableSource.kind !== 'session' || paths.length === 0) return;
    const value = await apiRef.current.markChangesReviewed(stableSource.ownerId, paths);
    // The review result is newer than any summary still on its way.
    generation.current += 1;
    storeSummary(value, paths);
  }, [stableSource, storeSummary]);

  let diff: Load<ChangesFileDiff> | null = null;
  if (selectedPath !== null) {
    diff = diffEntry !== null && diffEntry.source === sourceKey && diffEntry.path === selectedPath
      ? diffEntry.load
      : LOADING;
  }

  return { summary, selectedPath, setSelectedPath, diff, reload, markReviewed };
}
