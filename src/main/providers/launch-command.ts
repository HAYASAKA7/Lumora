import type { ProviderId } from '../../shared/contracts';
import { providerDefinition } from '../../shared/provider-definitions';

const RESUME_ARGUMENTS: Partial<
  Record<ProviderId, (nativeSessionId: string) => string[]>
> = {
  codex: (nativeSessionId) => ['resume', nativeSessionId],
  claude: (nativeSessionId) => ['--resume', nativeSessionId],
  gemini: (nativeSessionId) => ['--resume', nativeSessionId],
  opencode: (nativeSessionId) => ['--session', nativeSessionId],
  copilot: (nativeSessionId) => ['--session-id', nativeSessionId],
  qwen: (nativeSessionId) => ['--resume', nativeSessionId]
};

export function buildResumeArguments(
  provider: ProviderId,
  nativeSessionId: string
): string[] {
  const buildArguments = RESUME_ARGUMENTS[provider];
  if (!buildArguments) {
    throw new Error(
      `${providerDefinition(provider).displayName} does not support exact session resume in Lumora.`
    );
  }
  return buildArguments(nativeSessionId);
}
