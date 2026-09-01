import { useCallback, useRef, useState } from 'react';

import type {
  AgentRuntimeStartResult,
  AgentInteractionRoute,
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
  operationId: string;
  interactionRoute: AgentInteractionRoute;
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
  cancelAgentRuntimeStart?: LumoraApi['cancelAgentRuntimeStart'];
  closeStructuredRuntime?: LumoraApi['closeStructuredRuntime'];
  terminateRuntime?: LumoraApi['terminateRuntime'];
}

interface UseDirectSessionLaunchOptions {
  api: DirectSessionLaunchApi;
  autoTrustWorkspaces: boolean;
  mode: 'agent' | 'pty';
  createOperationId?: () => string;
  onStarted(
    result: DirectSessionLaunchResult,
    preview: LaunchPreview,
    activate: boolean
  ): void;
}

function prepareRequest(
  sessionId: string,
  interactionRoute: AgentInteractionRoute
): LaunchPrepareRequest {
  return {
    strategy: 'resume',
    sessionId,
    interactionRoute,
    startPrompt: '',
    terminalProfileId: null,
    cols: 100,
    rows: 30
  };
}

function createAgentLaunchOperationId(): string {
  return globalThis.crypto.randomUUID();
}

export function useDirectSessionLaunch({
  api,
  autoTrustWorkspaces,
  mode,
  createOperationId = createAgentLaunchOperationId,
  onStarted
}: UseDirectSessionLaunchOptions) {
  const [launch, setLaunch] = useState<DirectSessionLaunchState | null>(null);
  const [visibleLaunchId, setVisibleLaunchId] = useState<number | null>(null);
  const launchRef = useRef<DirectSessionLaunchState | null>(null);
  const nextId = useRef(0);
  const visibleId = useRef<number | null>(null);
  const inFlight = useRef(new Set<number>());
  const cancelled = useRef(new Set<number>());

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
        if (cancelled.current.has(id)) return;
        confirmedPreview = { ...preview, workspaceTrusted: true };
      }
      if (cancelled.current.has(id)) return;
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
        const operationId = launchRef.current?.id === id
          ? launchRef.current.operationId
          : null;
        if (operationId === null) return;
        result = await startAgentRuntime(preview.launchToken, operationId);
      } else {
        result = await api.startRuntime(preview.launchToken);
      }
      if (cancelled.current.has(id)) {
        if ('mode' in result) {
          if (result.mode === 'pty') {
            await api.terminateRuntime?.(result.runtime.id).catch(() => undefined);
          } else {
            await api.closeStructuredRuntime?.(
              result.runtime.connectionId
            ).catch(() => undefined);
          }
        } else {
          await api.terminateRuntime?.(result.id).catch(() => undefined);
        }
        return;
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
      if (cancelled.current.has(id)) return;
      updateLaunch(id, (current) => ({ ...current, phase: 'error' }));
    } finally {
      inFlight.current.delete(id);
      cancelled.current.delete(id);
    }
  }, [api, mode, onStarted, updateLaunch]);

  const begin = useCallback((
    session: SessionSummary,
    workspace: WorkspaceSummary,
    interactionRoute: AgentInteractionRoute = 'automatic'
  ) => {
    const current = launchRef.current;
    if (
      current !== null &&
      current.session.id === session.id &&
      current.workspace.id === workspace.id &&
      current.interactionRoute === interactionRoute
    ) {
      visibleId.current = current.id;
      setVisibleLaunchId(current.id);
      return;
    }
    if (
      current !== null &&
      current.session.id === session.id &&
      current.workspace.id === workspace.id
    ) {
      cancelled.current.add(current.id);
      if (mode === 'agent') {
        void api.cancelAgentRuntimeStart?.(current.operationId)
          .catch(() => undefined);
      }
    }
    const id = nextId.current + 1;
    const operationId = createOperationId();
    nextId.current = id;
    visibleId.current = id;
    inFlight.current.add(id);
    const next = {
      id,
      operationId,
      interactionRoute,
      phase: 'preparing',
      preview: null,
      session,
      workspace
    } satisfies DirectSessionLaunchState;
    launchRef.current = next;
    setLaunch(next);
    setVisibleLaunchId(id);
    void api.prepareLaunch(prepareRequest(session.id, interactionRoute)).then((preview) => {
      if (cancelled.current.has(id)) {
        inFlight.current.delete(id);
        cancelled.current.delete(id);
        return;
      }
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
  }, [api, autoTrustWorkspaces, createOperationId, mode, startPrepared, updateLaunch]);

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
    begin(launch.session, launch.workspace, launch.interactionRoute);
  }, [begin, launch]);

  const hide = useCallback(() => {
    visibleId.current = null;
    setVisibleLaunchId(null);
  }, []);

  const cancel = useCallback(async () => {
    const current = launchRef.current;
    if (current === null) return;
    cancelled.current.add(current.id);
    launchRef.current = null;
    visibleId.current = null;
    setLaunch(null);
    setVisibleLaunchId(null);
    if (mode === 'agent') {
      await api.cancelAgentRuntimeStart?.(current.operationId)
        .catch(() => undefined);
    }
  }, [api, mode]);

  const show = useCallback(() => {
    const current = launchRef.current;
    if (current === null) return;
    visibleId.current = current.id;
    setVisibleLaunchId(current.id);
  }, []);

  return {
    hasLaunch: launch !== null,
    cancel,
    hide,
    launch: launch?.id === visibleLaunchId ? launch : null,
    open: begin,
    retry,
    show,
    trustAndContinue
  };
}
