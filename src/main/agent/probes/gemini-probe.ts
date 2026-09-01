import type { StructuredProviderCapabilityReport } from '../../../shared/agent/provider-capabilities';
import type { LineJsonRpcTransport } from '../transport/line-json-rpc';
import { acpProviderProfile } from '../acp/acp-provider-profiles';
import { probeAcpStructuredProvider } from './acp-probe';
import type { ProbeClock } from './probe-report';

export interface ProbeGeminiStructuredProviderOptions {
  executablePath: string;
  version: string;
  clientVersion?: string;
  createTransport(executablePath: string): Promise<LineJsonRpcTransport>;
  now?: ProbeClock;
}

export async function probeGeminiStructuredProvider({
  executablePath,
  version,
  clientVersion = 'unknown',
  createTransport,
  now
}: ProbeGeminiStructuredProviderOptions): Promise<StructuredProviderCapabilityReport> {
  return probeAcpStructuredProvider({
    profile: acpProviderProfile('gemini'),
    executablePath,
    version,
    clientVersion,
    createTransport,
    ...(now === undefined ? {} : { now })
  });
}
