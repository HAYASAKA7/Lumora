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
});
