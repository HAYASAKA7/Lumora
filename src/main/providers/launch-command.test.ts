import { describe, expect, it } from 'vitest';

import { buildResumeArguments } from './launch-command';

describe('buildResumeArguments', () => {
  it('builds atomic Codex resume arguments', () => {
    expect(buildResumeArguments('codex', 'thread-123')).toEqual([
      'resume',
      'thread-123'
    ]);
  });

  it('builds atomic Claude Code resume arguments', () => {
    expect(buildResumeArguments('claude', 'session-456')).toEqual([
      '--resume',
      'session-456'
    ]);
  });

  it.each([
    ['gemini', ['--resume', 'native-1']],
    ['opencode', ['--session', 'native-1']],
    ['copilot', ['--session-id', 'native-1']],
    ['qwen', ['--resume', 'native-1']]
  ] as const)('builds atomic %s resume arguments', (provider, expected) => {
    expect(buildResumeArguments(provider, 'native-1')).toEqual(expected);
  });

  it('rejects launch-only providers', () => {
    expect(() => buildResumeArguments('aider', 'native-1')).toThrow(
      'Aider does not support exact session resume in Lumora.'
    );
  });
});
