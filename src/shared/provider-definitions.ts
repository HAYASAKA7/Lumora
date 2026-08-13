import type { ProviderId } from './contracts';
import { providerProbe } from './provider-probes';

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
    ...providerProbe('codex'),
    displayName: 'Codex',
    sessionSupport: 'complete',
    installGuideUrl: 'https://developers.openai.com/codex/cli/'
  },
  {
    ...providerProbe('claude'),
    displayName: 'Claude Code',
    sessionSupport: 'complete',
    installGuideUrl: 'https://docs.anthropic.com/en/docs/claude-code/setup'
  },
  {
    ...providerProbe('gemini'),
    displayName: 'Gemini CLI',
    sessionSupport: 'complete',
    installGuideUrl: 'https://github.com/google-gemini/gemini-cli'
  },
  {
    ...providerProbe('antigravity'),
    displayName: 'Antigravity',
    sessionSupport: 'launch_only',
    installGuideUrl: 'https://antigravity.google/docs/cli-getting-started'
  },
  {
    ...providerProbe('opencode'),
    displayName: 'OpenCode',
    sessionSupport: 'complete',
    installGuideUrl: 'https://opencode.ai/docs/'
  },
  {
    ...providerProbe('cursor'),
    displayName: 'Cursor CLI',
    sessionSupport: 'launch_only',
    installGuideUrl: 'https://cursor.com/docs/cli/installation'
  },
  {
    ...providerProbe('copilot'),
    displayName: 'GitHub Copilot CLI',
    sessionSupport: 'complete',
    installGuideUrl:
      'https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli'
  },
  {
    ...providerProbe('qwen'),
    displayName: 'Qwen Code',
    sessionSupport: 'complete',
    installGuideUrl: 'https://qwenlm.github.io/qwen-code-docs/en/'
  },
  {
    ...providerProbe('kimi'),
    displayName: 'Kimi Code',
    sessionSupport: 'complete',
    installGuideUrl: 'https://www.kimi.com/help/kimi-code/cli-getting-started'
  },
  {
    ...providerProbe('amp'),
    displayName: 'Amp',
    sessionSupport: 'launch_only',
    installGuideUrl: 'https://ampcode.com/manual'
  },
  {
    ...providerProbe('crush'),
    displayName: 'Crush',
    sessionSupport: 'launch_only',
    installGuideUrl: 'https://github.com/charmbracelet/crush'
  },
  {
    ...providerProbe('goose'),
    displayName: 'goose',
    sessionSupport: 'launch_only',
    installGuideUrl: 'https://block.github.io/goose/docs/getting-started/installation'
  },
  {
    ...providerProbe('aider'),
    displayName: 'Aider',
    sessionSupport: 'launch_only',
    installGuideUrl: 'https://aider.chat/docs/install.html'
  }
] as const satisfies readonly ProviderDefinition[]);

const PROVIDERS_BY_ID = new Map<ProviderId, ProviderDefinition>(
  PROVIDER_DEFINITIONS.map((definition) => [
    definition.provider,
    definition
  ])
);

const VERIFIED_START_PROMPT_PROVIDER_IDS = new Set<ProviderId>([
  'codex',
  'claude',
  'gemini',
  'opencode',
  'copilot',
  'qwen'
]);

const NATIVE_FORK_PROVIDER_IDS = new Set<ProviderId>([
  'codex',
  'claude',
  'opencode'
]);

const SESSION_HANDOFF_DESTINATION_PROVIDER_IDS = new Set<ProviderId>([
  'codex',
  'claude',
  'gemini',
  'opencode',
  'copilot',
  'qwen'
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

export function hasVerifiedStartPromptSupport(
  provider: ProviderId
): boolean {
  return VERIFIED_START_PROMPT_PROVIDER_IDS.has(provider);
}

export function hasNativeForkSupport(provider: ProviderId): boolean {
  return NATIVE_FORK_PROVIDER_IDS.has(provider);
}

export function hasSessionHandoffSourceSupport(provider: ProviderId): boolean {
  return hasCompleteSessionSupport(provider);
}

export function hasSessionHandoffDestinationSupport(
  provider: ProviderId
): boolean {
  return SESSION_HANDOFF_DESTINATION_PROVIDER_IDS.has(provider);
}

export function supportsManagedProviderUpdate(provider: ProviderId): boolean {
  return provider !== 'kimi' && providerDefinition(provider).npmPackage !== null;
}

export function providerMinimumInstallNodeVersion(
  provider: ProviderId
): readonly [number, number, number] | null {
  return provider === 'kimi' ? [22, 19, 0] : null;
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
