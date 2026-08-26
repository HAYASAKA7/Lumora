import type {
  StructuredAgentAction,
  StructuredAgentLaunchRequest,
  StructuredAgentProviderId
} from '../../../shared/agent/contracts';
import type { StructuredAgentEventDraft } from '../runtime/event-sequencer';

export interface ResolvedStructuredAgentLaunch {
  request: StructuredAgentLaunchRequest;
  workspaceId: string;
  catalogSessionId: string | null;
  nativeSessionId: string | null;
  title: string;
}

export interface StructuredAgentAdapterCallbacks {
  emit(event: StructuredAgentEventDraft): void;
  exited(error: Error | null): void;
}

export interface StructuredAgentAdapterContext {
  connectionId: string;
  providerId: StructuredAgentProviderId;
  generation: number;
  launch: ResolvedStructuredAgentLaunch;
  callbacks: StructuredAgentAdapterCallbacks;
}

export interface StructuredAgentAdapter {
  open(): Promise<{ nativeSessionId: string }>;
  dispatch(action: StructuredAgentAction): Promise<void>;
  close(): Promise<void>;
}

export type CreateStructuredAgentAdapter = (
  context: StructuredAgentAdapterContext
) => Promise<StructuredAgentAdapter> | StructuredAgentAdapter;
