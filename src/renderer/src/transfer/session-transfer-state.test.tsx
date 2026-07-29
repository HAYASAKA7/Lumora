import { describe, expect, it } from 'vitest';

import type { SessionTransferProgressEvent } from '../../../shared/contracts';
import {
  INITIAL_IMPORT_FLOW_STATE,
  reduceImportFlow
} from './session-transfer-state';

const FIRST_OPERATION = '0198f8b6-18f3-7ca0-9f0f-123456789abc';
const OTHER_OPERATION = '0198f8b6-18f3-7ca0-9f0f-abcdefabcdef';

function progress(
  operationId = FIRST_OPERATION
): SessionTransferProgressEvent {
  return {
    operationId,
    direction: 'import',
    phase: 'verifying',
    completed: 1,
    total: 2,
    message: 'Verifying imported sessions.'
  };
}

describe('session transfer import flow', () => {
  it('advances only through editable steps in order', () => {
    const providers = reduceImportFlow(INITIAL_IMPORT_FLOW_STATE, {
      type: 'advance',
      step: 'providers'
    });
    const workspaces = reduceImportFlow(providers, {
      type: 'advance',
      step: 'workspaces'
    });
    const review = reduceImportFlow(workspaces, {
      type: 'advance',
      step: 'review'
    });

    expect(review.step).toBe('review');
    expect(
      reduceImportFlow(review, { type: 'advance', step: 'providers' })
    ).toBe(review);
  });

  it('claims the first operation identity and ignores progress from old operations', () => {
    const executing = reduceImportFlow(INITIAL_IMPORT_FLOW_STATE, {
      type: 'begin_execution'
    });
    const claimed = reduceImportFlow(executing, {
      type: 'progress',
      event: progress()
    });
    const ignored = reduceImportFlow(claimed, {
      type: 'progress',
      event: progress(OTHER_OPERATION)
    });

    expect(claimed.operationId).toBe(FIRST_OPERATION);
    expect(claimed.progress).toEqual(progress());
    expect(ignored).toBe(claimed);
  });

  it('makes cancellation terminal and cannot return to editable review', () => {
    const executing = reduceImportFlow(INITIAL_IMPORT_FLOW_STATE, {
      type: 'begin_execution'
    });
    const claimed = reduceImportFlow(executing, {
      type: 'progress',
      event: progress()
    });
    const cancelled = reduceImportFlow(claimed, {
      type: 'cancelled',
      operationId: FIRST_OPERATION
    });

    expect(cancelled).toMatchObject({ step: 'result', outcome: 'cancelled' });
    expect(reduceImportFlow(cancelled, { type: 'back' })).toBe(cancelled);
    expect(
      reduceImportFlow(cancelled, { type: 'advance', step: 'review' })
    ).toBe(cancelled);
  });
});
