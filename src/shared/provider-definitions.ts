import type { ProviderId } from './contracts';

export type SessionSupport = 'complete' | 'launch_only';

export interface ProviderDefinition {
  provider: ProviderId;
  displayName: string;
  command: string;
  versionArgs: readonly string[];
  sessionSupport: SessionSupport;
  npmPackage: string | null;
  installGuideUrl: string;
}

export const PROVIDER_DEFINITIONS = Object.freeze([
  {
    provider: 'codex',
    displayName: 'Codex',
    command: 'codex',
    versionArgs: ['--version'],
    sessionSupport: 'complete',
    npmPackage: '@openai/codex',
    installGuideUrl: 'https://developers.openai.com/codex/cli/'
  },
  {
    provider: 'claude',
    displayName: 'Claude Code',
    command: 'claude',
    versionArgs: ['--version'],
    sessionSupport: 'complete',
    npmPackage: '@anthropic-ai/claude-code',
    installGuideUrl: 'https://docs.anthropic.com/en/docs/claude-code/setup'
  },
  {
    provider: 'gemini',
    displayName: 'Gemini CLI',
    command: 'gemini',
    versionArgs: ['--version'],
    sessionSupport: 'complete',
    npmPackage: '@google/gemini-cli',
    installGuideUrl: 'https://github.com/google-gemini/gemini-cli'
  },
  {
    provider: 'antigravity',
    displayName: 'Antigravity',
    command: 'agy',
    versionArgs: ['--version'],
    sessionSupport: 'launch_only',
    npmPackage: null,
    installGuideUrl: 'https://antigravity.google/docs/cli-getting-started'
  },
  {
    provider: 'opencode',
    displayName: 'OpenCode',
    command: 'opencode',
    versionArgs: ['--version'],
    sessionSupport: 'complete',
    npmPackage: 'opencode-ai',
    installGuideUrl: 'https://opencode.ai/docs/'
  },
  {
    provider: 'cursor',
    displayName: 'Cursor CLI',
    command: 'cursor-agent',
    versionArgs: ['--version'],
    sessionSupport: 'launch_only',
    npmPackage: null,
    installGuideUrl: 'https://cursor.com/docs/cli/installation'
  },
  {
    provider: 'copilot',
    displayName: 'GitHub Copilot CLI',
    command: 'copilot',
    versionArgs: ['version'],
    sessionSupport: 'complete',
    npmPackage: '@github/copilot',
    installGuideUrl:
      'https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli'
  },
  {
    provider: 'qwen',
    displayName: 'Qwen Code',
    command: 'qwen',
    versionArgs: ['--version'],
    sessionSupport: 'complete',
    npmPackage: '@qwen-code/qwen-code',
    installGuideUrl: 'https://qwenlm.github.io/qwen-code-docs/en/'
  },
  {
    provider: 'amp',
    displayName: 'Amp',
    command: 'amp',
    versionArgs: ['--version'],
    sessionSupport: 'launch_only',
    npmPackage: null,
    installGuideUrl: 'https://ampcode.com/manual'
  },
  {
    provider: 'crush',
    displayName: 'Crush',
    command: 'crush',
    versionArgs: ['--version'],
    sessionSupport: 'launch_only',
    npmPackage: '@charmland/crush',
    installGuideUrl: 'https://github.com/charmbracelet/crush'
  },
  {
    provider: 'goose',
    displayName: 'goose',
    command: 'goose',
    versionArgs: ['--version'],
    sessionSupport: 'launch_only',
    npmPackage: null,
    installGuideUrl: 'https://block.github.io/goose/docs/getting-started/installation'
  },
  {
    provider: 'aider',
    displayName: 'Aider',
    command: 'aider',
    versionArgs: ['--version'],
    sessionSupport: 'launch_only',
    npmPackage: null,
    installGuideUrl: 'https://aider.chat/docs/install.html'
  }
] as const satisfies readonly ProviderDefinition[]);

const PROVIDERS_BY_ID = new Map<ProviderId, ProviderDefinition>(
  PROVIDER_DEFINITIONS.map((definition) => [
    definition.provider,
    definition
  ])
);

const NATIVE_FORK_PROVIDER_IDS = new Set<ProviderId>([
  'codex',
  'claude',
  'opencode'
]);

const NATIVE_FORK_MINIMUM_VERSIONS: Readonly<
  Partial<Record<ProviderId, readonly [number, number, number]>>
> = Object.freeze({
  codex: [0, 120, 0],
  claude: [1, 0, 90],
  opencode: [1, 0, 0]
});

export const SESSION_PROVIDER_IDS = Object.freeze(
  PROVIDER_DEFINITIONS
    .filter(({ sessionSupport }) => sessionSupport === 'complete')
    .map(({ provider }) => provider)
) as readonly ProviderId[];

export function providerDefinition(provider: ProviderId): ProviderDefinition {
  return PROVIDERS_BY_ID.get(provider) as ProviderDefinition;
}

export function hasCompleteSessionSupport(provider: ProviderId): boolean {
  return providerDefinition(provider).sessionSupport === 'complete';
}

export function hasNativeForkSupport(provider: ProviderId): boolean {
  return NATIVE_FORK_PROVIDER_IDS.has(provider);
}

export function nativeForkMinimumVersion(provider: ProviderId): string | null {
  const minimum = NATIVE_FORK_MINIMUM_VERSIONS[provider];
  return minimum === undefined ? null : minimum.join('.');
}

export function supportsNativeForkVersion(
  provider: ProviderId,
  versionOutput: string | null
): boolean {
  const minimum = NATIVE_FORK_MINIMUM_VERSIONS[provider];
  if (minimum === undefined || versionOutput === null) return false;
  const match = /(?:^|[^0-9])(\d+)\.(\d+)\.(\d+)(?![0-9])/.exec(
    versionOutput
  );
  if (match === null) return false;
  const installed = match.slice(1, 4).map(Number);
  for (let index = 0; index < minimum.length; index += 1) {
    if (installed[index] !== minimum[index]) {
      return installed[index]! > minimum[index]!;
    }
  }
  return true;
}

export function isCatalogProvider(provider: ProviderId): boolean {
  return hasCompleteSessionSupport(provider);
}
