import { z } from 'zod';

import {
  STRUCTURED_AGENT_PROVIDER_IDS,
  StructuredAgentProviderIdSchema
} from './contracts';

export const STRUCTURED_INTEGRATIONS = [
  'codex_app_server',
  'claude_agent_sdk',
  'gemini_acp',
  'opencode_acp',
  'cursor_acp',
  'copilot_acp',
  'qwen_acp',
  'kimi_acp',
  'goose_acp'
] as const;

export const StructuredIntegrationSchema = z.enum(STRUCTURED_INTEGRATIONS);

export const StructuredAgentCapabilitiesSchema = z.strictObject({
  newSession: z.boolean(),
  resumeSession: z.boolean(),
  history: z.boolean(),
  streaming: z.boolean(),
  toolActivity: z.boolean(),
  approvals: z.boolean(),
  cancellation: z.boolean(),
  usage: z.boolean(),
  attachments: z.boolean()
});

const StructuredProviderIssueSchema = z.strictObject({
  code: z.enum([
    'STRUCTURED_ROUTE_UNAVAILABLE',
    'STRUCTURED_VERSION_UNSUPPORTED',
    'STRUCTURED_PROBE_FAILED',
    'STRUCTURED_PROBE_TIMED_OUT'
  ]),
  message: z.string().trim().min(1).max(512),
  recovery: z.string().trim().min(1).max(512),
  retryable: z.boolean()
});

const CapabilityReportFields = {
  providerId: StructuredAgentProviderIdSchema,
  integration: StructuredIntegrationSchema,
  checkedAt: z.iso.datetime(),
  version: z.string().trim().min(1).max(256).nullable()
};

export const StructuredProviderCapabilityReportSchema = z.discriminatedUnion(
  'state',
  [
    z.strictObject({
      ...CapabilityReportFields,
      state: z.literal('verified'),
      capabilities: StructuredAgentCapabilitiesSchema,
      issue: z.null()
    }),
    z.strictObject({
      ...CapabilityReportFields,
      state: z.enum(['unavailable', 'incompatible', 'failed', 'timed_out']),
      capabilities: z.null(),
      issue: StructuredProviderIssueSchema
    })
  ]
);

export const ProviderInteractionRouteSchema = z.strictObject({
  mode: z.enum(['structured', 'pty']),
  reason: z.enum([
    'verified',
    'disabled',
    'unavailable',
    'incompatible',
    'failed',
    'timed_out'
  ])
});

export const StructuredProviderPreferenceSchema = z.strictObject({
  providerId: StructuredAgentProviderIdSchema,
  useUnifiedWhenAvailable: z.boolean(),
  executablePathOverride: z.string().trim().min(1).max(32_768).nullable()
});

export const StructuredProviderPreferenceListSchema = z.array(
  StructuredProviderPreferenceSchema
).length(STRUCTURED_AGENT_PROVIDER_IDS.length);

export const StructuredProviderPreferenceInputSchema =
  StructuredProviderPreferenceSchema;

export interface SelectProviderInteractionRouteOptions {
  preferenceEnabled: boolean;
  report: StructuredProviderCapabilityReport;
}

export function selectProviderInteractionRoute({
  preferenceEnabled,
  report
}: SelectProviderInteractionRouteOptions): ProviderInteractionRoute {
  if (!preferenceEnabled) {
    return { mode: 'pty', reason: 'disabled' };
  }
  if (report.state === 'verified') {
    return { mode: 'structured', reason: 'verified' };
  }
  return { mode: 'pty', reason: report.state };
}

export type StructuredIntegration = z.infer<typeof StructuredIntegrationSchema>;
export type StructuredAgentCapabilities = z.infer<
  typeof StructuredAgentCapabilitiesSchema
>;
export type StructuredProviderCapabilityReport = z.infer<
  typeof StructuredProviderCapabilityReportSchema
>;
export type ProviderInteractionRoute = z.infer<
  typeof ProviderInteractionRouteSchema
>;
export type StructuredProviderPreference = z.infer<
  typeof StructuredProviderPreferenceSchema
>;
