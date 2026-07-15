import type {
  ProviderScanResult,
  SessionSummary,
  TerminalProfile,
  WorkspaceSummary
} from '../../../shared/contracts';

interface SessionResumeEligibilityInput {
  session: SessionSummary;
  workspace: WorkspaceSummary | undefined;
  providerScan: ProviderScanResult | null;
  profiles: readonly TerminalProfile[];
}

export function resolveSessionResumeDisabledReason({
  session,
  workspace,
  providerScan,
  profiles
}: SessionResumeEligibilityInput): string | null {
  if (session.sourceFreshness !== 'current') {
    return 'Session source is stale.';
  }

  if (workspace === undefined || !workspace.available) {
    return 'Workspace is unavailable.';
  }

  const provider = providerScan?.providers.find(
    (installation) => installation.provider === session.provider
  );
  if (provider?.state !== 'ready') {
    return 'Provider is unavailable.';
  }

  if (!profiles.some((profile) => profile.available)) {
    return 'No terminal profile is available.';
  }

  return null;
}
