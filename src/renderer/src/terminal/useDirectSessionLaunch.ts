import { useCallback, useRef, useState } from 'react';

import type {
  AgentRuntimeStartResult,
  LaunchPrepareRequest,
  LaunchPreview,
  LumoraApi,
  RuntimeSummary,
  SessionSummary,
  WorkspaceSummary
} from '../../../shared/contracts';

export type DirectSessionLaunchPhase =
  | 'preparing'
  | 'awaiting-trust'
  | 'trusting'
  | 'starting'
  | 'error';

export interface DirectSessionLaunchState {
  id: number;
  phase: DirectSessionLaunchPhase;
  preview: LaunchPreview | null;
  session: SessionSummary;
  workspace: WorkspaceSummary;
}

type DirectSessionLaunchResult = AgentRuntimeStartResult | RuntimeSummary;

interface DirectSessionLaunchApi extends Pick<
  LumoraApi,
  'prepareLaunch' | 'trustWorkspaceForLaunch' | 'startRuntime'
> {
  startAgentRuntime?: LumoraApi['startAgentRuntime'];
}

interface UseDirectSessionLaunchOptions {
  api: DirectSessionLaunchApi;
  autoTrustWorkspaces: boolean;
  mode: 'agent' | 'pty';
  onStarted(
    result: DirectSessionLaunchResult,
    preview: LaunchPreview,
    activate: boolean
  ): void;
}

function prepareRequest(sessionId: string): LaunchPrepareRequest {
  return {
    strategy: 'resume',
    sessionId,
    startPrompt: '',
    terminalProfileId: null,
    cols: 100,
    rows: 30
  };
}

export function useDirectSessionLaunch({
  api,
  autoTrustWorkspaces,
  mode,
  onStarted
}: UseDirectSessionLaunchOptions) {
  const [launch, setLaunch] = useState<DirectSessionLaunchState | null>(null);
  const [visibleLaunchId, setVisibleLaunchId] = useState<number | null>(null);
  const launchRef = useRef<DirectSessionLaunchState | null>(null);
  const nextId = useRef(0);
  const visibleId = useRef<number | null>(null);
  const inFlight = useRef(new Set<number>());

  const updateLaunch = useCallback((
    id: number,
    update: (current: DirectSessionLaunchState) => DirectSessionLaunchState
  ) => {
    const current = launchRef.current;
    if (current === null || current.id !== id) return;
    const next = update(current);
    launchRef.current = next;
    setLaunch(next);
  }, []);

  const startPrepared = useCallback(async (
    id: number,
    preview: LaunchPreview,
    trustRequired: boolean
  ) => {
    let confirmedPreview = preview;
    try {
      if (trustRequired) {
        updateLaunch(id, (current) => ({ ...current, phase: 'trusting' }));
        await api.trustWorkspaceForLaunch(preview.launchToken);
        confirmedPreview = { ...preview, workspaceTrusted: true };
      }
      updateLaunch(id, (current) => ({
        ...current,
        phase: 'starting',
        preview: confirmedPreview
      }));
      const startAgentRuntime = api.startAgentRuntime;
      let result: DirectSessionLaunchResult;
      if (mode === 'agent') {
        if (startAgentRuntime === undefined) {
          updateLaunch(id, (current) => ({ ...current, phase: 'error' }));
          return;
        }
        result = await startAgentRuntime(preview.launchToken);
      } else {
        result = await api.startRuntime(preview.launchToken);
      }
      const activate = visibleId.current === id;
      if (launchRef.current?.id === id) {
        launchRef.current = null;
        setLaunch(null);
      }
      if (visibleId.current === id) {
        visibleId.current = null;
        setVisibleLaunchId(null);
      }
      onStarted(result, confirmedPreview, activate);
    } catch {
      updateLaunch(id, (current) => ({ ...current, phase: 'error' }));
    } finally {
      inFlight.current.delete(id);
    }
  }, [api, mode, onStarted, updateLaunch]);

  const begin = useCallback((session: SessionSummary, workspace: WorkspaceSummary) => {
    const current = launchRef.current;
    if (
      current !== null &&
      current.session.id === session.id &&
      current.workspace.id === workspace.id
    ) {
      visibleId.current = current.id;
      setVisibleLaunchId(current.id);
      return;
    }
    const id = nextId.current + 1;
    nextId.current = id;
    visibleId.current = id;
    inFlight.current.add(id);
    const next = {
      id,
      phase: 'preparing',
      preview: null,
      session,
      workspace
    } satisfies DirectSessionLaunchState;
    launchRef.current = next;
    setLaunch(next);
    setVisibleLaunchId(id);
    void api.prepareLaunch(prepareRequest(session.id)).then((preview) => {
      if (!preview.workspaceTrusted && !autoTrustWorkspaces) {
        inFlight.current.delete(id);
        updateLaunch(id, (current) => ({
          ...current,
          phase: 'awaiting-trust',
          preview
        }));
        return;
      }
      void startPrepared(id, preview, !preview.workspaceTrusted);
    }, () => {
      inFlight.current.delete(id);
      updateLaunch(id, (current) => ({ ...current, phase: 'error' }));
    });
  }, [api, autoTrustWorkspaces, startPrepared, updateLaunch]);

  const trustAndContinue = useCallback(() => {
    if (
      launch === null ||
      launch.phase !== 'awaiting-trust' ||
      launch.preview === null ||
      inFlight.current.has(launch.id)
    ) return;
    inFlight.current.add(launch.id);
    void startPrepared(launch.id, launch.preview, true);
  }, [launch, startPrepared]);

  const retry = useCallback(() => {
    if (launch === null || launch.phase !== 'error') return;
    launchRef.current = null;
    setLaunch(null);
    begin(launch.session, launch.workspace);
  }, [begin, launch]);

  const hide = useCallback(() => {
    visibleId.current = null;
    setVisibleLaunchId(null);
  }, []);

  const show = useCallback(() => {
    const current = launchRef.current;
    if (current === null) return;
    visibleId.current = current.id;
    setVisibleLaunchId(current.id);
  }, []);

  return {
    hasLaunch: launch !== null,
    hide,
    launch: launch?.id === visibleLaunchId ? launch : null,
    open: begin,
    retry,
    show,
    trustAndContinue
  };
}
