import type { StructuredProviderCapabilityReport } from '../../../shared/agent/provider-capabilities';
import {
  failedReport,
  incompatibleReport,
  verifiedReport,
  type ProbeClock
} from './probe-report';

const PINNED_SDK_VERSION = '0.3.246';
const PINNED_CLAUDE_CODE_VERSION = '2.1.246';

export interface ClaudeSdkDescriptor {
  sdkVersion: string;
  claudeCodeVersion: string;
  queryAvailable: boolean;
}

export interface ProbeClaudeStructuredProviderOptions {
  executablePath: string;
  version: string;
  loadSdk?: () => Promise<ClaudeSdkDescriptor>;
  now?: ProbeClock;
}

function versionTuple(value: string): readonly [number, number, number] | null {
  const match = /(?:^|[^0-9])(\d+)\.(\d+)\.(\d+)(?![0-9])/.exec(value);
  if (match === null) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isCompatible(runtimeVersion: string, sdkRuntimeVersion: string): boolean {
  const runtime = versionTuple(runtimeVersion);
  const sdkRuntime = versionTuple(sdkRuntimeVersion);
  if (runtime === null || sdkRuntime === null) return false;
  return runtime[0] === sdkRuntime[0] && runtime[1] === sdkRuntime[1];
}

async function loadPinnedSdk(): Promise<ClaudeSdkDescriptor> {
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  return {
    sdkVersion: PINNED_SDK_VERSION,
    claudeCodeVersion: PINNED_CLAUDE_CODE_VERSION,
    queryAvailable: typeof sdk.query === 'function'
  };
}

export async function probeClaudeStructuredProvider({
  executablePath,
  version,
  loadSdk = loadPinnedSdk,
  now
}: ProbeClaudeStructuredProviderOptions): Promise<StructuredProviderCapabilityReport> {
  const identity = {
    providerId: 'claude' as const,
    integration: 'claude_agent_sdk' as const,
    version,
    ...(now === undefined ? {} : { now })
  };
  if (executablePath.trim().length === 0) return failedReport(identity);
  try {
    const sdk = await loadSdk();
    if (
      !sdk.queryAvailable ||
      versionTuple(sdk.sdkVersion) === null ||
      !isCompatible(version, sdk.claudeCodeVersion)
    ) {
      return incompatibleReport(identity);
    }
    return verifiedReport(identity, {
      newSession: true,
      resumeSession: true,
      history: true,
      streaming: true,
      toolActivity: true,
      approvals: true,
      cancellation: true,
      usage: true,
      attachments: true
    });
  } catch {
    return failedReport(identity);
  }
}
