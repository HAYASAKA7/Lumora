import type { ProviderId } from '../../shared/contracts';
import { providerDefinition } from '../../shared/provider-definitions';

const USER_START_PROMPT_LIMIT = 4_096;
const MANAGED_HANDOFF_PROMPT_LIMIT = 8_192;

function positionalPromptArguments(startPrompt: string): string[] {
  if (startPrompt === '') return [];
  return startPrompt.startsWith('-')
    ? ['--', startPrompt]
    : [startPrompt];
}

function attachedPromptArgument(
  option: string,
  startPrompt: string
): string[] {
  return startPrompt === '' ? [] : [`${option}=${startPrompt}`];
}

const NEW_ARGUMENTS: Partial<
  Record<ProviderId, (startPrompt: string) => string[]>
> = {
  codex: positionalPromptArguments,
  claude: positionalPromptArguments,
  gemini: (startPrompt) =>
    attachedPromptArgument('--prompt-interactive', startPrompt),
  opencode: (startPrompt) =>
    attachedPromptArgument('--prompt', startPrompt),
  copilot: (startPrompt) =>
    attachedPromptArgument('--interactive', startPrompt),
  qwen: (startPrompt) =>
    attachedPromptArgument('--prompt-interactive', startPrompt)
};

const RESUME_ARGUMENTS: Partial<
  Record<
    ProviderId,
    (nativeSessionId: string, startPrompt: string) => string[]
  >
> = {
  codex: (nativeSessionId, startPrompt) => [
    'resume',
    nativeSessionId,
    ...positionalPromptArguments(startPrompt)
  ],
  claude: (nativeSessionId, startPrompt) => [
    '--resume',
    nativeSessionId,
    ...positionalPromptArguments(startPrompt)
  ],
  gemini: (nativeSessionId, startPrompt) => [
    '--resume',
    nativeSessionId,
    ...attachedPromptArgument('--prompt-interactive', startPrompt)
  ],
  opencode: (nativeSessionId, startPrompt) => [
    '--session',
    nativeSessionId,
    ...attachedPromptArgument('--prompt', startPrompt)
  ],
  copilot: (nativeSessionId, startPrompt) => [
    '--session-id',
    nativeSessionId,
    ...attachedPromptArgument('--interactive', startPrompt)
  ],
  qwen: (nativeSessionId, startPrompt) => [
    '--resume',
    nativeSessionId,
    ...attachedPromptArgument('--prompt-interactive', startPrompt)
  ]
};

const FORK_ARGUMENTS: Partial<
  Record<
    ProviderId,
    (nativeSessionId: string, startPrompt: string) => string[]
  >
> = {
  codex: (nativeSessionId, startPrompt) => [
    'fork',
    nativeSessionId,
    ...positionalPromptArguments(startPrompt)
  ],
  claude: (nativeSessionId, startPrompt) => [
    '--resume',
    nativeSessionId,
    '--fork-session',
    ...positionalPromptArguments(startPrompt)
  ],
  opencode: (nativeSessionId, startPrompt) => [
    '--session',
    nativeSessionId,
    '--fork',
    ...attachedPromptArgument('--prompt', startPrompt)
  ]
};

function normalizePrompt(
  prompt: string,
  limit: number,
  errorMessage: string
): string {
  if (prompt.length > limit || /[\0\r\n]/.test(prompt)) {
    throw new Error(errorMessage);
  }
  return prompt.trim().length === 0 ? '' : prompt;
}

function normalizeStartPrompt(startPrompt: string): string {
  return normalizePrompt(
    startPrompt,
    USER_START_PROMPT_LIMIT,
    'The start prompt is invalid.'
  );
}

function buildNewPromptArguments(
  provider: ProviderId,
  prompt: string
): string[] {
  if (prompt === '') return [];
  const buildArguments = NEW_ARGUMENTS[provider];
  if (!buildArguments) {
    throw new Error(
      `${providerDefinition(provider).displayName} does not support a start prompt in Lumora.`
    );
  }
  return buildArguments(prompt);
}

export function buildNewArguments(
  provider: ProviderId,
  startPrompt: string
): string[] {
  return buildNewPromptArguments(provider, normalizeStartPrompt(startPrompt));
}

export function buildManagedHandoffArguments(
  provider: ProviderId,
  managedPrompt: string
): string[] {
  return buildNewPromptArguments(
    provider,
    normalizePrompt(
      managedPrompt,
      MANAGED_HANDOFF_PROMPT_LIMIT,
      'The managed handoff prompt is invalid.'
    )
  );
}

export function buildResumeArguments(
  provider: ProviderId,
  nativeSessionId: string,
  startPrompt = ''
): string[] {
  const buildArguments = RESUME_ARGUMENTS[provider];
  if (!buildArguments) {
    throw new Error(
      `${providerDefinition(provider).displayName} does not support exact session resume in Lumora.`
    );
  }
  return buildArguments(
    nativeSessionId,
    normalizeStartPrompt(startPrompt)
  );
}

export function buildForkArguments(
  provider: ProviderId,
  nativeSessionId: string,
  startPrompt: string
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
  return buildArguments(
    nativeSessionId,
    normalizeStartPrompt(startPrompt)
  );
}
