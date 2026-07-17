import type { CatalogProviderId } from '../../shared/contracts';

export function buildResumeArguments(
  provider: CatalogProviderId,
  nativeSessionId: string
): string[] {
  return provider === 'codex'
    ? ['resume', nativeSessionId]
    : ['--resume', nativeSessionId];
}
