import { describe, expect, it } from 'vitest';

import {
  claudeLifetimeTokens,
  copilotLifetimeTokens,
  geminiLifetimeTokens,
  qwenLifetimeTokens
} from './provider-token-usage';

describe('provider lifetime token usage', () => {
  it('deduplicates Claude API responses and excludes cache telemetry', () => {
    const response = {
      type: 'assistant',
      message: {
        id: 'msg-1',
        usage: {
          input_tokens: 1_000,
          output_tokens: 250,
          cache_creation_input_tokens: 400,
          cache_read_input_tokens: 300
        }
      }
    };

    expect(
      claudeLifetimeTokens([
        response,
        response,
        {
          type: 'assistant',
          message: {
            id: 'msg-2',
            usage: { input_tokens: 80, output_tokens: 20 }
          }
        }
      ])
    ).toBe(1_350);
  });

  it('uses the newest Gemini snapshot per message and excludes cached input', () => {
    expect(
      geminiLifetimeTokens([
        {
          id: 'message-1',
          tokens: { input: 100, cached: 40, output: 20, thoughts: 5, total: 125 }
        },
        {
          id: 'message-1',
          tokens: { input: 200, cached: 50, output: 40, thoughts: 10, total: 250 }
        },
        {
          id: 'message-2',
          tokens: { input: 25, cached: 30, output: 7, thoughts: 3, total: 35 }
        }
      ])
    ).toBe(210);
  });

  it('uses Qwen assistant usage metadata and deduplicates record UUIDs', () => {
    expect(
      qwenLifetimeTokens([
        {
          uuid: 'turn-1',
          type: 'assistant',
          usageMetadata: {
            promptTokenCount: 300,
            cachedContentTokenCount: 120,
            candidatesTokenCount: 40,
            thoughtsTokenCount: 10,
            totalTokenCount: 350
          }
        },
        {
          uuid: 'turn-1',
          type: 'assistant',
          usageMetadata: {
            promptTokenCount: 300,
            cachedContentTokenCount: 120,
            candidatesTokenCount: 40,
            thoughtsTokenCount: 10
          }
        },
        { uuid: 'user-1', type: 'user', usageMetadata: { promptTokenCount: 999 } }
      ])
    ).toBe(230);
  });

  it('uses only the newest cumulative Copilot shutdown metrics', () => {
    expect(
      copilotLifetimeTokens([
        {
          type: 'session.shutdown',
          timestamp: '2026-07-22T01:00:00.000Z',
          data: {
            modelMetrics: {
              first: { usage: { inputTokens: 100, cacheReadTokens: 20, outputTokens: 30 } }
            }
          }
        },
        {
          type: 'session.shutdown',
          timestamp: '2026-07-22T02:00:00.000Z',
          data: {
            modelMetrics: {
              first: { usage: { inputTokens: 500, cacheReadTokens: 200, outputTokens: 70 } },
              second: { usage: { inputTokens: 50, cacheReadTokens: 10, outputTokens: 5 } }
            }
          }
        }
      ])
    ).toBe(415);
  });

  it('returns null instead of accepting invalid or overflowing counts', () => {
    expect(
      claudeLifetimeTokens([
        { message: { id: 'bad', usage: { input_tokens: -1, output_tokens: 4 } } }
      ])
    ).toBeNull();
    expect(
      geminiLifetimeTokens([
        {
          id: 'overflow',
          tokens: { input: Number.MAX_SAFE_INTEGER, output: 1, cached: 0, thoughts: 0 }
        }
      ])
    ).toBeNull();
    expect(qwenLifetimeTokens([{ uuid: 'bad', usageMetadata: { promptTokenCount: 1.5 } }])).toBeNull();
    expect(copilotLifetimeTokens([{ type: 'session.shutdown', data: {} }])).toBeNull();
  });
});
