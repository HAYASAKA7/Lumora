import type {
  StructuredAgentAction,
  StructuredAgentCommand,
  StructuredAgentLaunchRequest,
  StructuredAgentProviderId
} from '../../../shared/agent/contracts';
import type { ResolvedStructuredImage } from '../attachments/structured-image-store';
import type { StructuredAgentEventDraft } from '../runtime/event-sequencer';

export interface ResolvedStructuredAgentLaunch {
  request: StructuredAgentLaunchRequest;
  workspaceId: string;
  catalogSessionId: string | null;
  nativeSessionId: string | null;
  title: string;
  workingDirectory: string;
  executablePath: string;
}

export interface StructuredAgentAdapterCallbacks {
  emit(event: StructuredAgentEventDraft): void;
  commandsChanged?(commands: readonly StructuredAgentCommand[]): void;
  exited(error: Error | null): void;
}

export interface StructuredAgentAdapterContext {
  connectionId: string;
  providerId: StructuredAgentProviderId;
  generation: number;
  clientVersion?: string;
  launch: ResolvedStructuredAgentLaunch;
  callbacks: StructuredAgentAdapterCallbacks;
  /**
   * Resolves the image tokens a prompt carries to the files staged for this
   * session. Throws for a token staged for any other session.
   */
  resolveImages?(tokens: readonly string[]): readonly ResolvedStructuredImage[];
}

export interface StructuredAgentAdapter {
  open(): Promise<{
    nativeSessionId: string;
    initialEvents?: readonly StructuredAgentEventDraft[];
    commands?: readonly StructuredAgentCommand[];
    /** Whether the agent takes images in a prompt. */
    acceptsImages?: boolean;
  }>;
  activate?(): Promise<void>;
  dispatch(action: StructuredAgentAction): Promise<void>;
  close(): Promise<void>;
}

export type CreateStructuredAgentAdapter = (
  context: StructuredAgentAdapterContext
) => Promise<StructuredAgentAdapter> | StructuredAgentAdapter;
