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

/** What a session's tile and tab show in the status slot. */
export type SessionIndicator = SessionOutcomeKind | 'working';

/**
 * One slot, so one thing in it: a request for you that you have not seen
 * comes first, since the agent is waiting on you; then work in progress; then
 * a finish or failure you have not seen.
 */
export function sessionIndicator(
  unseen: SessionOutcomeKind | undefined,
  working: boolean
): SessionIndicator | undefined {
  if (unseen === 'needs_you') return 'needs_you';
  if (working) return 'working';
  return unseen;
}

/** Where a session stands right now: its outcome, and whether its agent is at work. */
export interface SessionState {
  outcome: SessionOutcome | null;
  /** A turn is running and not waiting on you. */
  working: boolean;
}

/** Where a Unified UI session stands; see {@link structuredSessionState}. */
export function structuredSessionOutcome(
  events: readonly StructuredAgentEvent[]
): SessionOutcome | null {
  return structuredSessionState(events).outcome;
}

/**
 * Where a Unified UI session stands: its last turn finished or failed, or the
 * agent is waiting on an approval or a question. The outcome is null while it
 * works, while it has done nothing yet, and after a turn you cancelled
 * yourself; it is working while a turn runs that is not waiting on you.
 *
 * Only the events from the last turn boundary on can change the answer, so the
 * history before it is not read again every time a message streams in.
 */
export function structuredSessionState(
  events: readonly StructuredAgentEvent[]
): SessionState {
  let start = events.length - 1;
  while (start > 0 && !TURN_BOUNDARY.has(events[start]!.kind)) start -= 1;

  let outcome: SessionOutcome | null = null;
  let running = false;
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
        running = true;
        break;
      case 'turn.completed':
        waiting.clear();
        running = false;
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
  return { outcome, working: running && waiting.size === 0 };
}
