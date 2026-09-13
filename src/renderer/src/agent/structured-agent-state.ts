import type {
  StructuredAgentApprovalDecision,
  StructuredAgentEvent,
  StructuredQuestion
} from '../../../shared/contracts';

type TurnState = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface StructuredAgentActivityView {
  id: string;
  kind: 'tool' | 'command' | 'file';
  title: string;
  detail: string | null;
  pathLabel: string | null;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
}

export interface StructuredAgentApprovalView {
  id: string;
  title: string;
  detail: string;
  choices: readonly StructuredAgentApprovalDecision[];
  decision: StructuredAgentApprovalDecision | null;
}

/**
 * Questions the agent asked during a turn. Only the outcome is kept: the
 * answers went to the agent and are not part of the conversation.
 */
export interface StructuredAgentQuestionView {
  id: string;
  source: 'agent' | 'mcp';
  serverName: string | null;
  message: string | null;
  link: string | null;
  questions: readonly StructuredQuestion[];
  outcome: 'answered' | 'declined' | 'cancelled' | null;
}

export interface StructuredAgentDiffView {
  id: string;
  files: readonly {
    pathLabel: string;
    oldPathLabel: string | null;
    additions: number;
    deletions: number;
    patch: string;
  }[];
}

export interface StructuredAgentTurnView {
  id: string;
  status: TurnState;
  userText: string;
  /** Images the user's message carried. The images themselves are not kept. */
  userImageCount: number;
  assistantText: string;
  reasoning: readonly string[];
  activities: readonly StructuredAgentActivityView[];
  diffs: readonly StructuredAgentDiffView[];
  approvals: readonly StructuredAgentApprovalView[];
  questions: readonly StructuredAgentQuestionView[];
  plan: readonly {
    id: string;
    text: string;
    status: 'pending' | 'in_progress' | 'completed';
  }[];
}

export interface StructuredAgentViewState {
  generation: number;
  sequence: number;
  runtimeState: 'starting' | 'ready' | 'reconnecting' | 'closed' | 'failed';
  turns: readonly StructuredAgentTurnView[];
  usage: {
    inputTokens: number | null;
    cachedInputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  } | null;
  accountUsage: {
    plan: string | null;
    windows: readonly {
      kind: 'primary' | 'secondary';
      usedPercent: number;
      windowDurationMinutes: number | null;
      resetsAt: number | null;
    }[];
  } | null;
  /** The agent's last error, with the turn it came from. */
  error: (Extract<StructuredAgentEvent, { kind: 'runtime.error' }>['payload'] & {
    turnId: string;
  }) | null;
}

export function createStructuredAgentViewState(): StructuredAgentViewState {
  return {
    generation: 0,
    sequence: -1,
    runtimeState: 'starting',
    turns: [],
    usage: null,
    accountUsage: null,
    error: null
  };
}

function emptyTurn(id: string): StructuredAgentTurnView {
  return {
    id,
    status: 'idle',
    userText: '',
    userImageCount: 0,
    assistantText: '',
    reasoning: [],
    activities: [],
    diffs: [],
    approvals: [],
    questions: [],
    plan: []
  };
}

function updateTurn(
  state: StructuredAgentViewState,
  turnId: string,
  update: (turn: StructuredAgentTurnView) => StructuredAgentTurnView
): StructuredAgentViewState {
  const index = state.turns.findIndex((turn) => turn.id === turnId);
  const turn = update(index === -1 ? emptyTurn(turnId) : state.turns[index]!);
  const turns = index === -1
    ? [...state.turns, turn]
    : state.turns.map((candidate, candidateIndex) =>
        candidateIndex === index ? turn : candidate
      );
  return { ...state, turns };
}

/**
 * Whether an event shows the agent has got past its last error. The turn that
 * failed recovers by completing, or by answering after a failure the provider
 * was retrying; any later turn recovers it by answering at all. A turn that
 * only starts proves nothing — a command's reply starts and completes a turn
 * of its own without the agent saying a word — so a usage limit or a refusal
 * stays until the agent is heard from again.
 */
function recoveredFrom(
  error: StructuredAgentViewState['error'],
  event: StructuredAgentEvent
): boolean {
  if (error === null) return false;
  const answered = event.kind === 'assistant.delta' || event.kind === 'assistant.message';
  if (event.turnId !== error.turnId) return answered;
  if (event.kind === 'turn.completed') return event.payload.state === 'completed';
  return answered && error.retryable;
}

export function reduceStructuredAgentEvent(
  state: StructuredAgentViewState,
  event: StructuredAgentEvent
): StructuredAgentViewState {
  if (
    event.generation < state.generation ||
    (event.generation === state.generation && event.sequence <= state.sequence)
  ) {
    return state;
  }
  let next: StructuredAgentViewState = {
    ...state,
    generation: event.generation,
    sequence: event.sequence,
    error: recoveredFrom(state.error, event) ? null : state.error
  };
  switch (event.kind) {
    case 'runtime.status':
      return {
        ...next,
        runtimeState: event.payload.state,
        error: event.payload.state === 'ready' ? null : next.error
      };
    case 'runtime.metadata':
    case 'runtime.commands':
      return next;
    case 'turn.started':
    case 'turn.completed':
      return updateTurn(next, event.turnId, (turn) => ({
        ...turn,
        status: event.payload.state
      }));
    case 'user.message':
      return updateTurn(next, event.turnId, (turn) => ({
        ...turn,
        userText: event.payload.text,
        userImageCount: event.payload.imageCount ?? 0
      }));
    case 'assistant.delta':
      return updateTurn(next, event.turnId, (turn) => ({
        ...turn,
        assistantText: turn.assistantText + event.payload.text
      }));
    case 'assistant.message':
      return updateTurn(next, event.turnId, (turn) => ({
        ...turn,
        assistantText: event.payload.text
      }));
    case 'reasoning.summary':
      return updateTurn(next, event.turnId, (turn) => ({
        ...turn,
        reasoning: [...turn.reasoning, event.payload.text]
      }));
    case 'tool.started':
    case 'command.started': {
      const kind = event.kind === 'tool.started' ? 'tool' : 'command';
      return updateTurn(next, event.turnId, (turn) => ({
        ...turn,
        activities: turn.activities.some(({ id }) => id === event.payload.activityId)
          ? turn.activities.map((activity) => activity.id === event.payload.activityId
            ? {
                ...activity,
                kind,
                title: event.payload.title,
                detail: event.payload.detail,
                status: 'running'
              }
            : activity)
          : [...turn.activities, {
              id: event.payload.activityId,
              kind,
              title: event.payload.title,
              detail: event.payload.detail,
              pathLabel: null,
              status: 'running'
            }]
      }));
    }
    case 'tool.updated':
    case 'command.updated': {
      const kind = event.kind === 'tool.updated' ? 'tool' : 'command';
      return updateTurn(next, event.turnId, (turn) => ({
        ...turn,
        activities: turn.activities.some(({ id }) => id === event.payload.activityId)
          ? turn.activities.map((activity) => activity.id === event.payload.activityId
            ? {
                ...activity,
                title: event.payload.title ?? activity.title,
                status: event.payload.status,
                detail: event.payload.detail
              }
            : activity)
          : [...turn.activities, {
              id: event.payload.activityId,
              kind,
              title: event.payload.title ?? (kind === 'command' ? 'Command' : 'Tool'),
              detail: event.payload.detail,
              pathLabel: null,
              status: event.payload.status
            }]
      }));
    }
    case 'file.changed':
      return updateTurn(next, event.turnId, (turn) => ({
        ...turn,
        activities: [...turn.activities, {
          id: event.payload.activityId,
          kind: 'file',
          title: event.payload.title,
          detail: event.payload.change,
          pathLabel: event.payload.pathLabel,
          status: 'completed'
        }]
      }));
    case 'diff.updated':
      return updateTurn(next, event.turnId, (turn) => ({
        ...turn,
        diffs: turn.diffs.some(({ id }) => id === event.payload.diffId)
          ? turn.diffs.map((diff) => diff.id === event.payload.diffId
            ? { id: event.payload.diffId, files: event.payload.files }
            : diff)
          : [...turn.diffs, { id: event.payload.diffId, files: event.payload.files }]
      }));
    case 'approval.requested':
      return updateTurn(next, event.turnId, (turn) => ({
        ...turn,
        approvals: [...turn.approvals, {
          id: event.payload.approvalId,
          title: event.payload.title,
          detail: event.payload.detail,
          choices: event.payload.choices,
          decision: null
        }]
      }));
    case 'approval.resolved':
      return updateTurn(next, event.turnId, (turn) => ({
        ...turn,
        approvals: turn.approvals.map((approval) =>
          approval.id === event.payload.approvalId
            ? { ...approval, decision: event.payload.decision }
            : approval
        )
      }));
    case 'question.requested':
      return updateTurn(next, event.turnId, (turn) => ({
        ...turn,
        // A replayed request is the same question, not a second one.
        questions: turn.questions.some((question) => question.id === event.payload.requestId)
          ? turn.questions
          : [...turn.questions, {
            id: event.payload.requestId,
            source: event.payload.source,
            serverName: event.payload.serverName,
            message: event.payload.message,
            link: event.payload.link,
            questions: event.payload.questions,
            outcome: null
          }]
      }));
    case 'question.resolved':
      return updateTurn(next, event.turnId, (turn) => ({
        ...turn,
        questions: turn.questions.map((question) =>
          question.id === event.payload.requestId
            ? { ...question, outcome: event.payload.outcome }
            : question
        )
      }));
    case 'plan.updated':
      return updateTurn(next, event.turnId, (turn) => ({
        ...turn,
        plan: event.payload.items
      }));
    case 'usage.updated':
      return { ...next, usage: event.payload };
    case 'account.usage.updated':
      return { ...next, accountUsage: event.payload };
    case 'runtime.error':
      return { ...next, error: { ...event.payload, turnId: event.turnId } };
  }
}
