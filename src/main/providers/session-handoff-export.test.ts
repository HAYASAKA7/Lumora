import { describe, expect, it } from 'vitest';

import { normalizeSessionHandoff } from './session-handoff-export';

describe('normalizeSessionHandoff', () => {
  it('normalizes Codex messages and a safe activity ledger', () => {
    const raw = [
      {
        timestamp: '2026-07-23T01:00:00.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Inspect the catalog.' }]
        }
      },
      {
        timestamp: '2026-07-23T01:01:00.000Z',
        type: 'response_item',
        payload: {
          type: 'reasoning',
          summary: [{ text: 'private reasoning' }]
        }
      },
      {
        timestamp: '2026-07-23T01:02:00.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'read_file',
          arguments: JSON.stringify({
            path: '/work/lumora/src/main.ts',
            token: 'must-not-appear'
          }),
          status: 'completed'
        }
      },
      {
        timestamp: '2026-07-23T01:03:00.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'The catalog is ready.' }]
        }
      }
    ].map((value) => JSON.stringify(value)).join('\n');

    const result = normalizeSessionHandoff('codex', raw);

    expect(result.messages).toEqual([
      {
        role: 'user',
        content: 'Inspect the catalog.',
        timestamp: '2026-07-23T01:00:00.000Z'
      },
      {
        role: 'assistant',
        content: 'The catalog is ready.',
        timestamp: '2026-07-23T01:03:00.000Z'
      }
    ]);
    expect(result.activities).toEqual([
      {
        toolName: 'read_file',
        referencedPaths: ['/work/lumora/src/main.ts'],
        timestamp: '2026-07-23T01:02:00.000Z',
        status: 'succeeded'
      }
    ]);
    expect(JSON.stringify(result)).not.toContain('private reasoning');
    expect(JSON.stringify(result)).not.toContain('must-not-appear');
  });

  it('normalizes Claude text blocks and tool completion without tool output', () => {
    const raw = [
      {
        type: 'user',
        timestamp: '2026-07-23T02:00:00.000Z',
        message: { role: 'user', content: 'Fix the tests.' }
      },
      {
        type: 'assistant',
        timestamp: '2026-07-23T02:01:00.000Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I will inspect the test.' },
            {
              type: 'tool_use',
              id: 'tool-1',
              name: 'Read',
              input: { file_path: '/work/lumora/test.ts', secret: 'hidden' }
            }
          ]
        }
      },
      {
        type: 'user',
        timestamp: '2026-07-23T02:02:00.000Z',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-1',
              content: 'raw private file content'
            }
          ]
        }
      }
    ].map((value) => JSON.stringify(value)).join('\n');

    const result = normalizeSessionHandoff('claude', raw);

    expect(result.messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: 'user', content: 'Fix the tests.' },
      { role: 'assistant', content: 'I will inspect the test.' }
    ]);
    expect(result.activities[0]).toMatchObject({
      toolName: 'Read',
      referencedPaths: ['/work/lumora/test.ts'],
      status: 'succeeded'
    });
    expect(JSON.stringify(result)).not.toContain('raw private file content');
    expect(JSON.stringify(result)).not.toContain('hidden');
  });

  it.each([
    [
      'gemini',
      JSON.stringify({
        messages: [
          { role: 'user', content: 'Gemini question', timestamp: '2026-07-23T03:00:00Z' },
          { role: 'model', content: 'Gemini answer', timestamp: '2026-07-23T03:01:00Z' }
        ]
      }),
      ['Gemini question', 'Gemini answer']
    ],
    [
      'copilot',
      [
        { type: 'user.message', timestamp: '2026-07-23T04:00:00Z', data: { content: 'Copilot question' } },
        { type: 'assistant.message', timestamp: '2026-07-23T04:01:00Z', data: { content: 'Copilot answer' } }
      ].map((value) => JSON.stringify(value)).join('\n'),
      ['Copilot question', 'Copilot answer']
    ],
    [
      'qwen',
      [
        { type: 'user', timestamp: '2026-07-23T05:00:00Z', message: { role: 'user', parts: [{ text: 'Qwen question' }] } },
        { type: 'assistant', timestamp: '2026-07-23T05:01:00Z', message: { role: 'assistant', parts: [{ text: 'Qwen answer' }] } }
      ].map((value) => JSON.stringify(value)).join('\n'),
      ['Qwen question', 'Qwen answer']
    ],
    [
      'opencode',
      JSON.stringify({
        messages: [
          { info: { role: 'user', time: { created: 1_784_270_000_000 } }, parts: [{ type: 'text', text: 'OpenCode question' }] },
          { info: { role: 'assistant', time: { created: 1_784_270_060_000 } }, parts: [{ type: 'text', text: 'OpenCode answer' }] }
        ]
      }),
      ['OpenCode question', 'OpenCode answer']
    ]
  ] as const)('normalizes %s user and assistant messages', (provider, raw, expected) => {
    const result = normalizeSessionHandoff(provider, raw);
    expect(result.messages.map((message) => message.content)).toEqual(expected);
    expect(result.messageCoverage).toBe('complete');
  });

  it('rejects an export with no readable user or assistant messages', () => {
    expect(() => normalizeSessionHandoff('codex', JSON.stringify({
      type: 'reasoning',
      content: 'private'
    }))).toThrow('does not contain a readable conversation');
  });

  it('rejects partially malformed JSONL instead of claiming complete coverage', () => {
    const raw = [
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Do not import partially.' }]
        }
      }),
      '{"type":"response_item"'
    ].join('\n');

    expect(() => normalizeSessionHandoff('codex', raw)).toThrow(
      'contains invalid JSONL'
    );
  });
});
