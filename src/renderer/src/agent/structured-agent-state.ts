import type {
  StructuredAgentApprovalDecision,
  StructuredAgentEvent
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
  assistantText: string;
  reasoning: readonly string[];
  activities: readonly StructuredAgentActivityView[];
  diffs: readonly StructuredAgentDiffView[];
  approvals: readonly StructuredAgentApprovalView[];
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
  error: { code: string; message: string; retryable: boolean } | null;
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
    assistantText: '',
    reasoning: [],
    activities: [],
    diffs: [],
    approvals: [],
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
    sequence: event.sequence
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
        userText: event.payload.text
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
      return { ...next, error: event.payload };
  }
}
