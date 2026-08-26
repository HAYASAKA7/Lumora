import { randomUUID } from 'node:crypto';

import {
  StructuredAgentEventSchema,
  type StructuredAgentEvent,
  type StructuredAgentProviderId
} from '../../../shared/agent/contracts';

type RuntimeOwnedEventFields =
  | 'connectionId'
  | 'providerId'
  | 'nativeSessionId'
  | 'eventId'
  | 'sequence'
  | 'generation'
  | 'timestamp';

export type StructuredAgentEventDraft =
  StructuredAgentEvent extends infer Event
    ? Event extends StructuredAgentEvent
      ? Omit<Event, RuntimeOwnedEventFields>
      : never
    : never;

interface StructuredAgentEventSequencerOptions {
  connectionId: string;
  providerId: StructuredAgentProviderId;
  generation: number;
  nativeSessionId: string | null;
  clock?: () => Date;
  createEventId?: () => string;
}

export class StructuredAgentEventSequencer {
  private generation: number;
  private nativeSessionId: string | null;
  private sequence = 0;
  private readonly clock: () => Date;
  private readonly createEventId: () => string;

  constructor(private readonly options: StructuredAgentEventSequencerOptions) {
    this.generation = options.generation;
    this.nativeSessionId = options.nativeSessionId;
    this.clock = options.clock ?? (() => new Date());
    this.createEventId = options.createEventId ?? randomUUID;
  }

  currentGeneration(): number {
    return this.generation;
  }

  bumpGeneration(): number {
    this.generation += 1;
    this.sequence = 0;
    return this.generation;
  }

  assignNativeSessionId(nativeSessionId: string): void {
    if (
      this.nativeSessionId !== null &&
      this.nativeSessionId !== nativeSessionId
    ) {
      throw new Error('A structured connection cannot change native session identity.');
    }
    this.nativeSessionId = nativeSessionId;
  }

  next(
    callbackGeneration: number,
    draft: StructuredAgentEventDraft
  ): StructuredAgentEvent | null {
    if (callbackGeneration !== this.generation) return null;
    const event = StructuredAgentEventSchema.parse({
      ...draft,
      connectionId: this.options.connectionId,
      providerId: this.options.providerId,
      nativeSessionId: this.nativeSessionId,
      eventId: this.createEventId(),
      sequence: this.sequence,
      generation: this.generation,
      timestamp: this.clock().toISOString()
    });
    this.sequence += 1;
    return event;
  }
}
