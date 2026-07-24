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

const FORK_ARGUMENTS: Partial<
  Record<ProviderId, (nativeSessionId: string, task: string) => string[]>
> = {
  codex: (nativeSessionId, task) => ['fork', nativeSessionId, task],
  claude: (nativeSessionId, task) =>
    ['--resume', nativeSessionId, '--fork-session', task],
  opencode: (nativeSessionId, task) =>
    ['--session', nativeSessionId, '--fork', '--prompt', task]
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

export function buildForkArguments(
  provider: ProviderId,
  nativeSessionId: string,
  task: string
): string[] {
  const buildArguments = FORK_ARGUMENTS[provider];
  if (!buildArguments) {
    throw new Error(
      `${providerDefinition(provider).displayName} does not support native session fork in Lumora.`
    );
  }
  if (
    nativeSessionId.trim().length === 0 ||
    nativeSessionId.length > 256 ||
    /[\0\r\n]/.test(nativeSessionId)
  ) {
    throw new Error('The native session identity is invalid.');
  }
  if (
    task.trim().length === 0 ||
    task.length > 4_096 ||
    /[\0\r\n]/.test(task)
  ) {
    throw new Error('The native session fork task is invalid.');
  }
  return buildArguments(nativeSessionId, task);
}
