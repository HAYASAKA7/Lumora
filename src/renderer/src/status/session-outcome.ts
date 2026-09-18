import type { SessionOutcomeKind, StructuredAgentEvent } from '../../../shared/contracts';

/** Where a session stands for someone who was not looking at it. */
export interface SessionOutcome {
  kind: SessionOutcomeKind;
  /**
   * The event the outcome came from. The same outcome read again keeps its
   * key, so only a new one is taken for news.
   */
  key: string;
}

const TURN_BOUNDARY = new Set<StructuredAgentEvent['kind']>(['turn.started', 'turn.completed']);

/**
 * Where a Unified UI session stands: its last turn finished or failed, or the
 * agent is waiting on an approval or a question. Null while it works, while it
 * has done nothing yet, and after a turn you cancelled yourself.
 *
 * Only the events from the last turn boundary on can change the answer, so the
 * history before it is not read again every time a message streams in.
 */
export function structuredSessionOutcome(
  events: readonly StructuredAgentEvent[]
): SessionOutcome | null {
  let start = events.length - 1;
  while (start > 0 && !TURN_BOUNDARY.has(events[start]!.kind)) start -= 1;

  let outcome: SessionOutcome | null = null;
  const waiting = new Set<string>();
  const settle = (id: string) => {
    waiting.delete(id);
    if (waiting.size === 0 && outcome?.kind === 'needs_you') outcome = null;
  };
  for (let index = Math.max(0, start); index < events.length; index += 1) {
    const event = events[index]!;
    switch (event.kind) {
      case 'turn.started':
        waiting.clear();
        outcome = null;
        break;
      case 'turn.completed':
        waiting.clear();
        outcome = event.payload.state === 'completed'
          ? { kind: 'finished', key: event.eventId }
          : event.payload.state === 'failed'
            ? { kind: 'failed', key: event.eventId }
            : null;
        break;
      case 'approval.requested':
        waiting.add(`approval:${event.payload.approvalId}`);
        outcome = { kind: 'needs_you', key: event.eventId };
        break;
      case 'question.requested':
        waiting.add(`question:${event.payload.requestId}`);
        outcome = { kind: 'needs_you', key: event.eventId };
        break;
      case 'approval.resolved':
        settle(`approval:${event.payload.approvalId}`);
        break;
      case 'question.resolved':
        settle(`question:${event.payload.requestId}`);
        break;
      default:
        break;
    }
  }
  return outcome;
}
