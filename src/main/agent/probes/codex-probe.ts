import { z } from 'zod';

import type { StructuredProviderCapabilityReport } from '../../../shared/agent/provider-capabilities';
import type { LineJsonRpcTransport } from '../transport/line-json-rpc';
import {
  failedReport,
  verifiedReport,
  type ProbeClock
} from './probe-report';

const CodexInitializeResultSchema = z.object({
  userAgent: z.string().trim().min(1).max(256),
  platformFamily: z.string().trim().min(1).max(64).optional(),
  platformOs: z.string().trim().min(1).max(64).optional()
});

export interface ProbeCodexStructuredProviderOptions {
  executablePath: string;
  version: string;
  createTransport(executablePath: string): Promise<LineJsonRpcTransport>;
  now?: ProbeClock;
}

export async function probeCodexStructuredProvider({
  executablePath,
  version,
  createTransport,
  now
}: ProbeCodexStructuredProviderOptions): Promise<StructuredProviderCapabilityReport> {
  const identity = {
    providerId: 'codex' as const,
    integration: 'codex_app_server' as const,
    version,
    ...(now === undefined ? {} : { now })
  };
  let transport: LineJsonRpcTransport | null = null;
  try {
    transport = await createTransport(executablePath);
    const initialized = CodexInitializeResultSchema.safeParse(
      await transport.request('initialize', {
        clientInfo: {
          name: 'lumora',
          title: 'Lumora',
          version: '0.4.2'
        },
        capabilities: null
      })
    );
    if (!initialized.success) return failedReport(identity);
    await transport.notify('initialized');
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
  } finally {
    await transport?.close().catch(() => undefined);
  }
}
