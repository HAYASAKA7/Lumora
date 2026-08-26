import { z } from 'zod';

import type { StructuredProviderCapabilityReport } from '../../../shared/agent/provider-capabilities';
import type { LineJsonRpcTransport } from '../transport/line-json-rpc';
import {
  failedReport,
  incompatibleReport,
  verifiedReport,
  type ProbeClock
} from './probe-report';

const GeminiInitializeResultSchema = z.object({
  protocolVersion: z.number().int().nonnegative(),
  agentInfo: z.object({
    name: z.string().trim().min(1).max(128),
    title: z.string().trim().min(1).max(128).optional(),
    version: z.string().trim().min(1).max(128).optional()
  }).nullable().optional(),
  agentCapabilities: z.object({
    loadSession: z.boolean().optional().default(false),
    promptCapabilities: z.object({
      image: z.boolean().optional().default(false),
      audio: z.boolean().optional().default(false),
      embeddedContext: z.boolean().optional().default(false)
    }).optional().default({
      image: false,
      audio: false,
      embeddedContext: false
    }),
    sessionCapabilities: z.object({
      list: z.unknown().optional()
    }).optional().default({})
  }).optional().default({
    loadSession: false,
    promptCapabilities: {
      image: false,
      audio: false,
      embeddedContext: false
    },
    sessionCapabilities: {}
  })
});

export interface ProbeGeminiStructuredProviderOptions {
  executablePath: string;
  version: string;
  createTransport(executablePath: string): Promise<LineJsonRpcTransport>;
  now?: ProbeClock;
}

export async function probeGeminiStructuredProvider({
  executablePath,
  version,
  createTransport,
  now
}: ProbeGeminiStructuredProviderOptions): Promise<StructuredProviderCapabilityReport> {
  const identity = {
    providerId: 'gemini' as const,
    integration: 'gemini_acp' as const,
    version,
    ...(now === undefined ? {} : { now })
  };
  let transport: LineJsonRpcTransport | null = null;
  try {
    transport = await createTransport(executablePath);
    const parsed = GeminiInitializeResultSchema.safeParse(
      await transport.request('initialize', {
        protocolVersion: 1,
        clientInfo: {
          name: 'lumora',
          title: 'Lumora',
          version: '0.4.2'
        },
        clientCapabilities: {
          auth: { terminal: false },
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false
        }
      })
    );
    if (!parsed.success) return failedReport(identity);
    if (parsed.data.protocolVersion !== 1) return incompatibleReport(identity);

    const prompt = parsed.data.agentCapabilities.promptCapabilities;
    return verifiedReport(identity, {
      newSession: true,
      resumeSession: parsed.data.agentCapabilities.loadSession,
      history: parsed.data.agentCapabilities.loadSession,
      streaming: true,
      toolActivity: true,
      approvals: true,
      cancellation: true,
      usage: false,
      attachments: prompt.image || prompt.audio || prompt.embeddedContext
    });
  } catch {
    return failedReport(identity);
  } finally {
    await transport?.close().catch(() => undefined);
  }
}
