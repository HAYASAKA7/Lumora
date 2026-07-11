import type { ProviderId } from '../../shared/contracts';

export function buildResumeArguments(
  provider: ProviderId,
  nativeSessionId: string
): string[] {
  return provider === 'codex'
    ? ['resume', nativeSessionId]
    : ['--resume', nativeSessionId];
}
