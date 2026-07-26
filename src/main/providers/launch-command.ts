import type { ProviderId } from '../../shared/contracts';
import { providerDefinition } from '../../shared/provider-definitions';

const NEW_ARGUMENTS: Partial<
  Record<ProviderId, (startPrompt: string) => string[]>
> = {
  codex: (startPrompt) => [startPrompt],
  claude: (startPrompt) => [startPrompt],
  gemini: (startPrompt) => ['-i', startPrompt],
  opencode: (startPrompt) => ['--prompt', startPrompt],
  copilot: (startPrompt) => ['-i', startPrompt],
  qwen: (startPrompt) => ['-i', startPrompt]
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
    ...(startPrompt === '' ? [] : [startPrompt])
  ],
  claude: (nativeSessionId, startPrompt) => [
    '--resume',
    nativeSessionId,
    ...(startPrompt === '' ? [] : [startPrompt])
  ],
  gemini: (nativeSessionId, startPrompt) => [
    '--resume',
    nativeSessionId,
    ...(startPrompt === '' ? [] : [startPrompt])
  ],
  opencode: (nativeSessionId, startPrompt) => [
    '--session',
    nativeSessionId,
    ...(startPrompt === '' ? [] : ['--prompt', startPrompt])
  ],
  copilot: (nativeSessionId, startPrompt) => [
    '--session-id',
    nativeSessionId,
    ...(startPrompt === '' ? [] : ['-i', startPrompt])
  ],
  qwen: (nativeSessionId, startPrompt) => [
    '--resume',
    nativeSessionId,
    ...(startPrompt === '' ? [] : [startPrompt])
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
    ...(startPrompt === '' ? [] : [startPrompt])
  ],
  claude: (nativeSessionId, startPrompt) => [
    '--resume',
    nativeSessionId,
    '--fork-session',
    ...(startPrompt === '' ? [] : [startPrompt])
  ],
  opencode: (nativeSessionId, startPrompt) => [
    '--session',
    nativeSessionId,
    '--fork',
    ...(startPrompt === '' ? [] : ['--prompt', startPrompt])
  ]
};

function normalizeStartPrompt(startPrompt: string): string {
  if (
    startPrompt.length > 4_096 ||
    /[\0\r\n]/.test(startPrompt)
  ) {
    throw new Error('The start prompt is invalid.');
  }
  return startPrompt.trim().length === 0 ? '' : startPrompt;
}

export function buildNewArguments(
  provider: ProviderId,
  startPrompt: string
): string[] {
  const normalizedStartPrompt = normalizeStartPrompt(startPrompt);
  if (normalizedStartPrompt === '') return [];
  const buildArguments = NEW_ARGUMENTS[provider];
  if (!buildArguments) {
    throw new Error(
      `${providerDefinition(provider).displayName} does not support a start prompt in Lumora.`
    );
  }
  return buildArguments(normalizedStartPrompt);
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

export function buildInitialPromptArguments(
  provider: ProviderId,
  startPrompt: string
): string[] {
  return buildNewArguments(provider, startPrompt);
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
