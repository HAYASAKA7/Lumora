import type {
  ChangedFile,
  ChangesSource,
  ChangesSummary,
  ChangesUnavailableReason
} from '../../shared/changes';
import { GitCommandError } from './git-runner';
import type { UnavailableReason } from './changes-repository';

export const MAX_SUMMARY_FILES = 5_000;

/** Why a snapshot or diff failed, in the words a summary uses. */
export function unavailableReasonFor(error: unknown): UnavailableReason {
  if (error instanceof GitCommandError) {
    if (error.reason === 'timeout') return 'too-large';
    if (error.reason === 'unavailable') return 'git-missing';
  }
  return 'failed';
}

/**
 * Splits a session's files into those that still differ from HEAD and those
 * whose content now equals a new commit.
 */
export function splitCommitted(
  sessionFiles: readonly ChangedFile[],
  uncommittedFiles: readonly ChangedFile[]
): { files: ChangedFile[]; committed: ChangedFile[] } {
  const uncommitted = new Set(uncommittedFiles.map(({ path }) => path));
  return {
    files: sessionFiles.filter(({ path }) => uncommitted.has(path)),
    committed: sessionFiles.filter(({ path }) => !uncommitted.has(path))
  };
}

export interface SummaryContext {
  source: ChangesSource;
  workspaceId: string;
  baselineLate: boolean;
  sharedWorkspace: boolean;
}

export function readySummary(
  context: SummaryContext,
  files: readonly ChangedFile[],
  committed: readonly ChangedFile[],
  checkedAt: string
): ChangesSummary {
  return {
    ...context,
    state: 'ready',
    unavailableReason: null,
    files: files.slice(0, MAX_SUMMARY_FILES),
    committed: committed.slice(0, MAX_SUMMARY_FILES),
    truncated: files.length > MAX_SUMMARY_FILES || committed.length > MAX_SUMMARY_FILES,
    checkedAt
  };
}

export function pendingSummary(
  context: SummaryContext,
  state: 'capturing' | 'unavailable',
  unavailableReason: ChangesUnavailableReason | null
): ChangesSummary {
  return {
    ...context,
    state,
    unavailableReason: state === 'unavailable' ? unavailableReason ?? 'failed' : null,
    files: [],
    committed: [],
    truncated: false,
    checkedAt: null
  };
}
