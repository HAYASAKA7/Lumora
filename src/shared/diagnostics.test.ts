import { describe, expect, it } from 'vitest';

import {
  DiagnosticBundleSchema,
  DiagnosticEventSchema,
  DiagnosticSummarySchema
} from './diagnostics';

const event = {
  id: '0198f8b6-18f3-7ca0-9f0f-123456789abc',
  recordedAt: '2026-08-13T07:00:00.000Z',
  severity: 'error',
  subsystem: 'terminal',
  operation: 'runtime.stop',
  outcome: 'failed',
  correlationId: '0198f8b6-18f3-7ca0-9f0f-123456789abd',
  provider: 'codex',
  targetKind: 'local',
  code: 'TERMINAL_OPERATION_FAILED',
  durationMs: 125,
  counts: { active: 1, queued: 0 }
} as const;

describe('diagnostic contracts', () => {
  it('accepts only bounded structured event fields', () => {
    expect(DiagnosticEventSchema.parse(event)).toEqual(event);
    expect(() => DiagnosticEventSchema.parse({
      ...event,
      message: 'prompt and private exception text'
    })).toThrow();
    expect(() => DiagnosticEventSchema.parse({
      ...event,
      path: 'C:\\Users\\private\\session.jsonl'
    })).toThrow();
    expect(() => DiagnosticEventSchema.parse({
      ...event,
      terminalOutput: 'secret terminal output'
    })).toThrow();
  });

  it('rejects free-form identifiers and unbounded numeric data', () => {
    expect(() => DiagnosticEventSchema.parse({
      ...event,
      operation: 'open C:\\Users\\private'
    })).toThrow();
    expect(() => DiagnosticEventSchema.parse({
      ...event,
      code: 'raw failure: /home/private'
    })).toThrow();
    expect(() => DiagnosticEventSchema.parse({
      ...event,
      counts: { active: Number.MAX_SAFE_INTEGER }
    })).toThrow();
  });

  it('bounds summaries and diagnostic exports', () => {
    const summary = DiagnosticSummarySchema.parse({
      generatedAt: '2026-08-13T07:01:00.000Z',
      previousRunAbnormal: true,
      journal: { storedEvents: 1, invalidRecords: 0 },
      processes: {
        processCount: 3,
        workingSetBytes: 150_000_000,
        cpuPercent: 2.5
      },
      recentEvents: [event]
    });
    expect(DiagnosticBundleSchema.parse({
      schemaVersion: 1,
      generatedAt: summary.generatedAt,
      lumora: {
        version: '0.3.2',
        platform: 'win32',
        architecture: 'x64'
      },
      summary
    }).summary.previousRunAbnormal).toBe(true);
    expect(() => DiagnosticSummarySchema.parse({
      ...summary,
      recentEvents: Array.from({ length: 101 }, () => event)
    })).toThrow();
  });
});
