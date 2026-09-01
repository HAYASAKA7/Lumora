import type { StructuredAgentProviderId } from '../../../shared/agent/contracts';
import type { StructuredIntegration } from '../../../shared/agent/provider-capabilities';

export const ACP_PROVIDER_IDS = [
  'gemini',
  'opencode',
  'cursor',
  'copilot',
  'qwen',
  'kimi',
  'goose'
] as const satisfies readonly StructuredAgentProviderId[];

export type AcpProviderId = typeof ACP_PROVIDER_IDS[number];

export interface AcpProviderProfile {
  providerId: AcpProviderId;
  displayName: string;
  integration: StructuredIntegration;
  arguments: readonly string[];
  authentication: 'gemini_configured' | 'advertised';
}

const PROFILES: Readonly<Record<AcpProviderId, AcpProviderProfile>> = Object.freeze({
  gemini: Object.freeze({
    providerId: 'gemini',
    displayName: 'Gemini CLI',
    integration: 'gemini_acp',
    arguments: Object.freeze(['--acp']),
    authentication: 'gemini_configured'
  }),
  opencode: Object.freeze({
    providerId: 'opencode',
    displayName: 'OpenCode',
    integration: 'opencode_acp',
    arguments: Object.freeze(['acp']),
    authentication: 'advertised'
  }),
  cursor: Object.freeze({
    providerId: 'cursor',
    displayName: 'Cursor CLI',
    integration: 'cursor_acp',
    arguments: Object.freeze(['acp']),
    authentication: 'advertised'
  }),
  copilot: Object.freeze({
    providerId: 'copilot',
    displayName: 'GitHub Copilot CLI',
    integration: 'copilot_acp',
    arguments: Object.freeze(['--acp', '--stdio']),
    authentication: 'advertised'
  }),
  qwen: Object.freeze({
    providerId: 'qwen',
    displayName: 'Qwen Code',
    integration: 'qwen_acp',
    arguments: Object.freeze(['--acp']),
    authentication: 'advertised'
  }),
  kimi: Object.freeze({
    providerId: 'kimi',
    displayName: 'Kimi Code',
    integration: 'kimi_acp',
    arguments: Object.freeze(['acp']),
    authentication: 'advertised'
  }),
  goose: Object.freeze({
    providerId: 'goose',
    displayName: 'goose',
    integration: 'goose_acp',
    arguments: Object.freeze(['acp']),
    authentication: 'advertised'
  })
});

export function isAcpProvider(
  providerId: StructuredAgentProviderId
): providerId is AcpProviderId {
  return ACP_PROVIDER_IDS.some((candidate) => candidate === providerId);
}

export function acpProviderProfile(providerId: AcpProviderId): AcpProviderProfile {
  return PROFILES[providerId];
}
