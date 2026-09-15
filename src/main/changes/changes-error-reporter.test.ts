import { describe, expect, it, vi } from 'vitest';

import { DiagnosticEventSchema } from '../../shared/diagnostics';
import { createChangesErrorReporter } from './changes-error-reporter';
import { GitCommandError } from './git-runner';

function harness() {
  let now = Date.parse('2026-09-15T00:00:00.000Z');
  const record = vi.fn(async (_input: unknown) => undefined);
  const report = createChangesErrorReporter({ record, clock: () => new Date(now) });
  return {
    record,
    report,
    advance(milliseconds: number) {
      now += milliseconds;
    }
  };
}

describe('createChangesErrorReporter', () => {
  it.each([
    ['timeout', 'GIT_TIMEOUT'],
    ['unavailable', 'GIT_UNAVAILABLE'],
    ['output-too-large', 'GIT_OUTPUT_TOO_LARGE'],
    ['failed', 'GIT_FAILED']
  ] as const)('records a git %s failure as %s without its message', (reason, code) => {
    const { record, report } = harness();

    report('baseline', new GitCommandError(reason));

    expect(record).toHaveBeenCalledExactlyOnceWith({
      severity: 'warning',
      subsystem: 'changes',
      operation: 'changes-baseline',
      outcome: 'failed',
      targetKind: 'local',
      code
    });
  });

  it('records other failures with a generic code and a valid event shape', () => {
    const { record, report } = harness();

    report('refresh', new Error('C:\\private\\workspace exploded'));

    const input = record.mock.calls[0]![0] as Record<string, unknown>;
    expect(input).toMatchObject({ operation: 'changes-refresh', code: 'CHANGES_FAILED' });
    expect(JSON.stringify(input)).not.toContain('private');
    expect(() => DiagnosticEventSchema.parse({
      ...input,
      id: '0198f8b6-18f3-7ca0-9f0f-123456789abc',
      recordedAt: '2026-09-15T00:00:00.000Z',
      correlationId: '0198f8b6-18f3-7ca0-9f0f-123456789abd'
    })).not.toThrow();
  });

  it('records one event per operation and reason every ten minutes', () => {
    const { advance, record, report } = harness();

    report('refresh', new GitCommandError('timeout'));
    report('refresh', new GitCommandError('timeout'));
    report('refresh', new GitCommandError('failed'));
    report('summary', new GitCommandError('timeout'));
    expect(record).toHaveBeenCalledTimes(3);

    advance(10 * 60 * 1_000 - 1);
    report('refresh', new GitCommandError('timeout'));
    expect(record).toHaveBeenCalledTimes(3);

    advance(1);
    report('refresh', new GitCommandError('timeout'));
    expect(record).toHaveBeenCalledTimes(4);
  });

  it('absorbs a failing journal', async () => {
    const record = vi.fn(async () => {
      throw new Error('journal unavailable');
    });
    const report = createChangesErrorReporter({ record, clock: () => new Date() });

    expect(() => report('startup', new Error('boom'))).not.toThrow();
    await Promise.resolve();
  });
});
