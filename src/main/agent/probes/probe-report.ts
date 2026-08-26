import {
  StructuredProviderCapabilityReportSchema,
  type StructuredAgentCapabilities,
  type StructuredIntegration,
  type StructuredProviderCapabilityReport
} from '../../../shared/agent/provider-capabilities';
import type { StructuredAgentProviderId } from '../../../shared/agent/contracts';

export type ProbeClock = () => Date;

interface ProbeIdentity {
  providerId: StructuredAgentProviderId;
  integration: StructuredIntegration;
  version: string | null;
  now?: ProbeClock;
}

function reportIdentity(identity: ProbeIdentity): {
  providerId: StructuredAgentProviderId;
  integration: StructuredIntegration;
  version: string | null;
  checkedAt: string;
} {
  return {
    providerId: identity.providerId,
    integration: identity.integration,
    version: identity.version,
    checkedAt: (identity.now ?? (() => new Date()))().toISOString()
  };
}

export function verifiedReport(
  identity: ProbeIdentity,
  capabilities: StructuredAgentCapabilities
): StructuredProviderCapabilityReport {
  return StructuredProviderCapabilityReportSchema.parse({
    ...reportIdentity(identity),
    state: 'verified',
    capabilities,
    issue: null
  });
}

export function incompatibleReport(
  identity: ProbeIdentity
): StructuredProviderCapabilityReport {
  return StructuredProviderCapabilityReportSchema.parse({
    ...reportIdentity(identity),
    state: 'incompatible',
    capabilities: null,
    issue: {
      code: 'STRUCTURED_VERSION_UNSUPPORTED',
      message: 'This provider version is not compatible with Lumora Structured UI.',
      recovery: 'Update the provider or continue in Terminal mode.',
      retryable: false
    }
  });
}

export function unavailableReport(
  identity: ProbeIdentity
): StructuredProviderCapabilityReport {
  return StructuredProviderCapabilityReportSchema.parse({
    ...reportIdentity(identity),
    state: 'unavailable',
    capabilities: null,
    issue: {
      code: 'STRUCTURED_ROUTE_UNAVAILABLE',
      message: 'This provider is not ready for Lumora Structured UI.',
      recovery: 'Install or repair the provider, then refresh provider discovery.',
      retryable: true
    }
  });
}

export function timedOutReport(
  identity: ProbeIdentity
): StructuredProviderCapabilityReport {
  return StructuredProviderCapabilityReportSchema.parse({
    ...reportIdentity(identity),
    state: 'timed_out',
    capabilities: null,
    issue: {
      code: 'STRUCTURED_PROBE_TIMED_OUT',
      message: 'The provider did not complete its structured capability check in time.',
      recovery: 'Retry the provider scan or continue in Terminal mode.',
      retryable: true
    }
  });
}

export function failedReport(
  identity: ProbeIdentity
): StructuredProviderCapabilityReport {
  return StructuredProviderCapabilityReportSchema.parse({
    ...reportIdentity(identity),
    state: 'failed',
    capabilities: null,
    issue: {
      code: 'STRUCTURED_PROBE_FAILED',
      message: 'Lumora could not verify this provider\'s structured connection.',
      recovery: 'Retry the provider scan or continue in Terminal mode.',
      retryable: true
    }
  });
}
