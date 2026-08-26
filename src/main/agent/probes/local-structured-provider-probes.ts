import type { SystemInfo } from '../../../shared/contracts';
import type { StructuredProviderCapabilityReport } from '../../../shared/agent/provider-capabilities';
import type { LineJsonRpcTransport } from '../transport/line-json-rpc';
import { spawnStructuredLineTransport } from '../transport/process-invocation';
import { probeClaudeStructuredProvider } from './claude-probe';
import { probeCodexStructuredProvider } from './codex-probe';
import { probeGeminiStructuredProvider } from './gemini-probe';
import type { ReadyStructuredProviderInstallation } from './structured-provider-probe-coordinator';

type Environment = Readonly<Record<string, string | undefined>>;

type CreateTransport = (
  executablePath: string,
  args: readonly string[],
  requestTimeoutMs: number
) => LineJsonRpcTransport;

type ProbeClaude = typeof probeClaudeStructuredProvider;

interface CreateLocalStructuredProviderProbeOptions {
  platform: SystemInfo['platform'];
  env: Environment;
  clientVersion?: string;
  createTransport?: CreateTransport;
  probeClaude?: ProbeClaude;
}

export function createLocalStructuredProviderProbe({
  platform,
  env,
  clientVersion = 'unknown',
  createTransport = (executablePath, args, requestTimeoutMs) =>
    spawnStructuredLineTransport(executablePath, args, {
      platform,
      env,
      requestTimeoutMs,
      maxFrameBytes: 1024 * 1024,
      closeGraceMs: 1_000
    }),
  probeClaude = probeClaudeStructuredProvider
}: CreateLocalStructuredProviderProbeOptions): (
  installation: ReadyStructuredProviderInstallation
) => Promise<StructuredProviderCapabilityReport> {
  return async (installation) => {
    if (installation.provider === 'codex') {
      return probeCodexStructuredProvider({
        executablePath: installation.executablePath,
        version: installation.version,
        clientVersion,
        createTransport: async (executablePath) =>
          createTransport(executablePath, ['app-server', '--stdio'], 10_000)
      });
    }
    if (installation.provider === 'gemini') {
      return probeGeminiStructuredProvider({
        executablePath: installation.executablePath,
        version: installation.version,
        clientVersion,
        createTransport: async (executablePath) =>
          createTransport(executablePath, ['--acp'], 30_000)
      });
    }
    return probeClaude({
      executablePath: installation.executablePath,
      version: installation.version
    });
  };
}
