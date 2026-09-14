import { useEffect, useRef, useState } from 'react';

import type {
  DiagnosticProcessDetails,
  DiagnosticResources,
  LumoraApi
} from '../../../shared/contracts';

/** How often a live figure is sampled while it is on screen. */
export const LIVE_SAMPLE_INTERVAL_MS = 2_000;
/** A sample still missing its CPU reading is followed sooner. */
export const LIVE_SAMPLE_PENDING_INTERVAL_MS = 1_000;

export type LiveSampleStatus<T> =
  | { state: 'loading' }
  | { state: 'ready'; value: T }
  | { state: 'error' };

/**
 * Samples `load` while `active`, one sample at a time. Nothing runs while the
 * view is closed or the window is hidden, so it costs nothing unseen.
 */
export function useLiveSample<T>(
  load: () => Promise<T>,
  active: boolean,
  nextDelay: (value: T, sampleNumber: number) => number
): LiveSampleStatus<T> {
  const [status, setStatus] = useState<LiveSampleStatus<T>>({ state: 'loading' });
  const loadRef = useRef(load);
  const nextDelayRef = useRef(nextDelay);
  loadRef.current = load;
  nextDelayRef.current = nextDelay;

  useEffect(() => {
    if (!active) return undefined;

    let cancelled = false;
    let sampling = false;
    let sampleNumber = 0;
    let timer: number | undefined;

    const schedule = (delay: number) => {
      timer = window.setTimeout(() => {
        timer = undefined;
        void sample();
      }, delay);
    };

    const sample = async () => {
      if (cancelled || sampling || document.visibilityState === 'hidden') return;
      sampling = true;
      let delay = LIVE_SAMPLE_INTERVAL_MS;
      try {
        const value = await loadRef.current();
        sampleNumber += 1;
        if (!cancelled) {
          setStatus({ state: 'ready', value });
          delay = nextDelayRef.current(value, sampleNumber);
        }
      } catch {
        if (!cancelled) setStatus({ state: 'error' });
      }
      sampling = false;
      if (!cancelled) schedule(delay);
    };

    const resume = () => {
      if (document.visibilityState === 'visible' && timer === undefined) void sample();
    };

    void sample();
    document.addEventListener('visibilitychange', resume);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', resume);
      if (timer !== undefined) window.clearTimeout(timer);
      // Figures from an earlier visit are not current; the next visit starts fresh.
      setStatus({ state: 'loading' });
    };
  }, [active]);

  return status;
}

export function useDiagnosticResources(
  api: Pick<LumoraApi, 'getDiagnosticResources'>,
  active: boolean
): LiveSampleStatus<DiagnosticResources> {
  return useLiveSample(
    () => api.getDiagnosticResources(),
    active,
    (resources) => (resources.lumora.cpuPercent === null
      ? LIVE_SAMPLE_PENDING_INTERVAL_MS
      : LIVE_SAMPLE_INTERVAL_MS)
  );
}

export function useDiagnosticProcesses(
  api: Pick<LumoraApi, 'getDiagnosticProcesses'>,
  active: boolean
): LiveSampleStatus<DiagnosticProcessDetails> {
  // CPU is measured between samples, so the first one never has it.
  return useLiveSample(
    () => api.getDiagnosticProcesses(),
    active,
    (_details, sampleNumber) => (sampleNumber === 1
      ? LIVE_SAMPLE_PENDING_INTERVAL_MS
      : LIVE_SAMPLE_INTERVAL_MS)
  );
}
