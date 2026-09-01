import { describe, expect, it } from 'vitest';

import {
  STRUCTURED_INTEGRATIONS,
  StructuredProviderCapabilityReportSchema,
  selectProviderInteractionRoute
} from './provider-capabilities';

const verified = StructuredProviderCapabilityReportSchema.parse({
  providerId: 'codex',
  integration: 'codex_app_server',
  state: 'verified',
  checkedAt: '2026-08-26T12:00:00.000Z',
  version: 'codex-cli 0.149.1',
  capabilities: {
    newSession: true,
    resumeSession: true,
    history: true,
    streaming: true,
    toolActivity: true,
    approvals: true,
    cancellation: true,
    usage: true,
    attachments: true
  },
  issue: null
});

describe('structured provider capabilities', () => {
  it('keeps native structured integration identities explicit', () => {
    expect(STRUCTURED_INTEGRATIONS).toEqual([
      'codex_app_server',
      'claude_agent_sdk',
      'gemini_acp',
      'opencode_acp',
      'cursor_acp',
      'copilot_acp',
      'qwen_acp',
      'kimi_acp',
      'goose_acp'
    ]);
  });

  it('selects structured UI only for a verified enabled route', () => {
    expect(selectProviderInteractionRoute({
      preferenceEnabled: true,
      report: verified
    })).toEqual({ mode: 'structured', reason: 'verified' });
  });

  it('uses deterministic PTY fallback for disabled or unhealthy routes', () => {
    expect(selectProviderInteractionRoute({
      preferenceEnabled: false,
      report: verified
    })).toEqual({ mode: 'pty', reason: 'disabled' });

    expect(selectProviderInteractionRoute({
      preferenceEnabled: true,
      report: {
        ...verified,
        state: 'incompatible',
        capabilities: null,
        issue: {
          code: 'STRUCTURED_VERSION_UNSUPPORTED',
          message: 'This provider version is not supported.',
          recovery: 'Update the provider or continue in Terminal mode.',
          retryable: false
        }
      }
    })).toEqual({ mode: 'pty', reason: 'incompatible' });
  });

  it('rejects capability claims for an unverified route', () => {
    expect(() => StructuredProviderCapabilityReportSchema.parse({
      ...verified,
      state: 'failed',
      issue: {
        code: 'STRUCTURED_PROBE_FAILED',
        message: 'The probe failed.',
        recovery: 'Retry or continue in Terminal mode.',
        retryable: true
      }
    })).toThrow();
  });

  it('keeps reports bounded and free of executable paths', () => {
    expect(() => StructuredProviderCapabilityReportSchema.parse({
      ...verified,
      executablePath: 'C:\\secret\\codex.cmd'
    })).toThrow();
  });
});
