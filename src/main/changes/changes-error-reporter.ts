import type { DiagnosticEvent } from '../../shared/diagnostics';
import { GitCommandError, type GitFailureReason } from './git-runner';
import type { ChangesOperation } from './workspace-changes-service';

const REPORT_INTERVAL_MS = 10 * 60 * 1_000;

const GIT_FAILURE_CODES: Readonly<Record<GitFailureReason, string>> = {
  timeout: 'GIT_TIMEOUT',
  unavailable: 'GIT_UNAVAILABLE',
  'missing-workspace': 'GIT_MISSING_WORKSPACE',
  'output-too-large': 'GIT_OUTPUT_TOO_LARGE',
  failed: 'GIT_FAILED'
};

type ChangesDiagnosticInput = Pick<
  DiagnosticEvent,
  'severity' | 'subsystem' | 'operation' | 'outcome' | 'targetKind' | 'code'
>;

interface ChangesErrorReporterOptions {
  record(input: ChangesDiagnosticInput): Promise<void>;
  clock?: () => Date;
}

function failureCode(error: unknown): string {
  return error instanceof GitCommandError ? GIT_FAILURE_CODES[error.reason] : 'CHANGES_FAILED';
}

/**
 * Turns recovered change-tracking failures into diagnostic events: only a
 * reason code, never a path or message, and at most one event per operation
 * and reason every ten minutes, since a broken workspace fails on every refresh.
 */
export function createChangesErrorReporter({
  record,
  clock = () => new Date()
}: ChangesErrorReporterOptions): (operation: ChangesOperation, error: unknown) => void {
  const lastRecordedAt = new Map<string, number>();
  return (operation, error) => {
    const code = failureCode(error);
    const key = `${operation}:${code}`;
    const now = clock().getTime();
    const previous = lastRecordedAt.get(key);
    if (previous !== undefined && now - previous < REPORT_INTERVAL_MS) return;
    lastRecordedAt.set(key, now);
    try {
      void record({
        severity: 'warning',
        subsystem: 'changes',
        operation: `changes-${operation}`,
        outcome: 'failed',
        targetKind: 'local',
        code
      }).catch(() => undefined);
    } catch {
      // Diagnostics must never disturb change tracking.
    }
  };
}
