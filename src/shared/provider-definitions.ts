import type { CatalogProviderId, ProviderId } from './contracts';

export interface ProviderDefinition {
  provider: ProviderId;
  displayName: string;
  command: string;
  versionArgs: readonly string[];
  catalogSupport: boolean;
  npmPackage: string | null;
  installGuideUrl: string;
}

export const PROVIDER_DEFINITIONS = Object.freeze([
  {
    provider: 'codex',
    displayName: 'Codex',
    command: 'codex',
    versionArgs: ['--version'],
    catalogSupport: true,
    npmPackage: '@openai/codex',
    installGuideUrl: 'https://developers.openai.com/codex/cli/'
  },
  {
    provider: 'claude',
    displayName: 'Claude Code',
    command: 'claude',
    versionArgs: ['--version'],
    catalogSupport: true,
    npmPackage: '@anthropic-ai/claude-code',
    installGuideUrl: 'https://docs.anthropic.com/en/docs/claude-code/setup'
  },
  {
    provider: 'gemini',
    displayName: 'Gemini CLI',
    command: 'gemini',
    versionArgs: ['--version'],
    catalogSupport: false,
    npmPackage: '@google/gemini-cli',
    installGuideUrl: 'https://github.com/google-gemini/gemini-cli'
  },
  {
    provider: 'antigravity',
    displayName: 'Antigravity',
    command: 'agy',
    versionArgs: ['--version'],
    catalogSupport: false,
    npmPackage: null,
    installGuideUrl: 'https://antigravity.google/docs/cli-getting-started'
  },
  {
    provider: 'opencode',
    displayName: 'OpenCode',
    command: 'opencode',
    versionArgs: ['--version'],
    catalogSupport: false,
    npmPackage: 'opencode-ai',
    installGuideUrl: 'https://opencode.ai/docs/'
  },
  {
    provider: 'cursor',
    displayName: 'Cursor CLI',
    command: 'cursor-agent',
    versionArgs: ['--version'],
    catalogSupport: false,
    npmPackage: null,
    installGuideUrl: 'https://cursor.com/docs/cli/installation'
  },
  {
    provider: 'copilot',
    displayName: 'GitHub Copilot CLI',
    command: 'copilot',
    versionArgs: ['version'],
    catalogSupport: false,
    npmPackage: '@github/copilot',
    installGuideUrl:
      'https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli'
  },
  {
    provider: 'qwen',
    displayName: 'Qwen Code',
    command: 'qwen',
    versionArgs: ['--version'],
    catalogSupport: false,
    npmPackage: '@qwen-code/qwen-code',
    installGuideUrl: 'https://qwenlm.github.io/qwen-code-docs/en/'
  },
  {
    provider: 'amp',
    displayName: 'Amp',
    command: 'amp',
    versionArgs: ['--version'],
    catalogSupport: false,
    npmPackage: null,
    installGuideUrl: 'https://ampcode.com/manual'
  },
  {
    provider: 'crush',
    displayName: 'Crush',
    command: 'crush',
    versionArgs: ['--version'],
    catalogSupport: false,
    npmPackage: '@charmland/crush',
    installGuideUrl: 'https://github.com/charmbracelet/crush'
  },
  {
    provider: 'goose',
    displayName: 'goose',
    command: 'goose',
    versionArgs: ['--version'],
    catalogSupport: false,
    npmPackage: null,
    installGuideUrl: 'https://block.github.io/goose/docs/getting-started/installation'
  },
  {
    provider: 'aider',
    displayName: 'Aider',
    command: 'aider',
    versionArgs: ['--version'],
    catalogSupport: false,
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

export function providerDefinition(provider: ProviderId): ProviderDefinition {
  return PROVIDERS_BY_ID.get(provider) as ProviderDefinition;
}

export function isCatalogProvider(
  provider: ProviderId
): provider is CatalogProviderId {
  return providerDefinition(provider).catalogSupport;
}
