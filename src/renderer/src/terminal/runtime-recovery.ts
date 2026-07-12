import type {
  ProviderId,
  RuntimeSummary,
  SessionSummary
} from '../../../shared/contracts';

export type RuntimeRecoveryPlan =
  | { strategy: 'resume'; session: SessionSummary }
  | { strategy: 'new'; provider: ProviderId; workspaceId: string };

export function resolveRuntimeRecovery(
  runtime: RuntimeSummary,
  sessions: readonly SessionSummary[]
): RuntimeRecoveryPlan | null {
  if (runtime.state !== 'runtime_lost') return null;

  const session =
    runtime.sessionId === null
      ? undefined
      : sessions.find(
          (candidate) =>
            candidate.id === runtime.sessionId &&
            candidate.sourceFreshness === 'current' &&
            candidate.provider === runtime.provider &&
            candidate.workspaceId === runtime.workspaceId
        );

  return session === undefined
    ? {
        strategy: 'new',
        provider: runtime.provider,
        workspaceId: runtime.workspaceId
      }
    : { strategy: 'resume', session };
}
