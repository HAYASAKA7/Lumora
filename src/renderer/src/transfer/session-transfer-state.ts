import type {
  SessionTransferProgressEvent,
  SessionTransferResult
} from '../../../shared/contracts';

export type ImportFlowStep =
  | 'unlock'
  | 'providers'
  | 'workspaces'
  | 'review'
  | 'progress'
  | 'result';

export type ImportFlowOutcome =
  | 'editing'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface ImportFlowState {
  step: ImportFlowStep;
  outcome: ImportFlowOutcome;
  operationId: string | null;
  progress: SessionTransferProgressEvent | null;
  result: SessionTransferResult | null;
}

export type ImportFlowAction =
  | { type: 'advance'; step: ImportFlowStep }
  | { type: 'back' }
  | { type: 'begin_execution' }
  | { type: 'progress'; event: SessionTransferProgressEvent }
  | { type: 'completed'; result: SessionTransferResult }
  | { type: 'cancelled'; operationId: string | null }
  | { type: 'failed' };

export const INITIAL_IMPORT_FLOW_STATE: ImportFlowState = Object.freeze({
  step: 'unlock',
  outcome: 'editing',
  operationId: null,
  progress: null,
  result: null
});

const EDITABLE_STEPS = ['unlock', 'providers', 'workspaces', 'review'] as const;

function isEditableStep(
  step: ImportFlowStep
): step is (typeof EDITABLE_STEPS)[number] {
  return EDITABLE_STEPS.includes(step as (typeof EDITABLE_STEPS)[number]);
}

export function reduceImportFlow(
  state: ImportFlowState,
  action: ImportFlowAction
): ImportFlowState {
  if (state.step === 'result') {
    return state;
  }

  switch (action.type) {
    case 'advance': {
      if (!isEditableStep(state.step) || !isEditableStep(action.step)) {
        return state;
      }

      const currentIndex = EDITABLE_STEPS.indexOf(state.step);
      if (EDITABLE_STEPS[currentIndex + 1] !== action.step) {
        return state;
      }

      return { ...state, step: action.step };
    }
    case 'back': {
      if (!isEditableStep(state.step)) {
        return state;
      }

      const currentIndex = EDITABLE_STEPS.indexOf(state.step);
      const previous = EDITABLE_STEPS[currentIndex - 1];
      return previous ? { ...state, step: previous } : state;
    }
    case 'begin_execution':
      if (state.outcome !== 'editing') {
        return state;
      }
      return {
        ...state,
        step: 'progress',
        outcome: 'running',
        operationId: null,
        progress: null,
        result: null
      };
    case 'progress': {
      if (state.step !== 'progress' || state.outcome !== 'running') {
        return state;
      }
      if (
        state.operationId !== null &&
        state.operationId !== action.event.operationId
      ) {
        return state;
      }
      return {
        ...state,
        operationId: action.event.operationId,
        progress: action.event
      };
    }
    case 'completed':
      if (
        state.step !== 'progress' ||
        state.outcome !== 'running' ||
        (state.operationId !== null &&
          state.operationId !== action.result.operationId)
      ) {
        return state;
      }
      return {
        ...state,
        step: 'result',
        outcome:
          action.result.status === 'cancelled'
            ? 'cancelled'
            : action.result.status === 'completed'
              ? 'completed'
              : 'failed',
        operationId: action.result.operationId,
        result: action.result
      };
    case 'cancelled':
      if (
        state.step !== 'progress' ||
        state.outcome !== 'running' ||
        (state.operationId !== null &&
          action.operationId !== null &&
          state.operationId !== action.operationId)
      ) {
        return state;
      }
      return {
        ...state,
        step: 'result',
        outcome: 'cancelled',
        operationId: action.operationId ?? state.operationId
      };
    case 'failed':
      if (state.step !== 'progress' || state.outcome !== 'running') {
        return state;
      }
      return { ...state, step: 'result', outcome: 'failed' };
  }
}
