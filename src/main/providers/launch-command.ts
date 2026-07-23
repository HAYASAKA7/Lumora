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

const INITIAL_PROMPT_ARGUMENTS: Partial<
  Record<ProviderId, (prompt: string) => string[]>
> = {
  codex: (prompt) => [prompt],
  claude: (prompt) => [prompt],
  gemini: (prompt) => ['-i', prompt],
  opencode: (prompt) => ['--prompt', prompt],
  copilot: (prompt) => ['-i', prompt],
  qwen: (prompt) => ['-i', prompt]
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

export function buildInitialPromptArguments(
  provider: ProviderId,
  prompt: string
): string[] {
  const buildArguments = INITIAL_PROMPT_ARGUMENTS[provider];
  if (!buildArguments) {
    throw new Error(
      `${providerDefinition(provider).displayName} does not support cross-agent handoff in Lumora.`
    );
  }
  if (
    prompt.trim().length === 0 ||
    prompt.length > 4_096 ||
    /[\0\r\n]/.test(prompt)
  ) {
    throw new Error('The cross-agent handoff prompt is invalid.');
  }
  return buildArguments(prompt);
}
