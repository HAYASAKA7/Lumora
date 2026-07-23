import { describe, expect, it } from 'vitest';

import {
  buildInitialPromptArguments,
  buildResumeArguments
} from './launch-command';

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

  it.each([
    ['antigravity', 'Antigravity'],
    ['cursor', 'Cursor CLI'],
    ['amp', 'Amp'],
    ['crush', 'Crush'],
    ['goose', 'goose'],
    ['aider', 'Aider']
  ] as const)('rejects launch-only provider %s', (provider, displayName) => {
    expect(() => buildResumeArguments(provider, 'native-1')).toThrow(
      `${displayName} does not support exact session resume in Lumora.`
    );
  });
});

describe('buildInitialPromptArguments', () => {
  const prompt = 'Read the Lumora handoff context.';

  it.each([
    ['codex', [prompt]],
    ['claude', [prompt]],
    ['gemini', ['-i', prompt]],
    ['opencode', ['--prompt', prompt]],
    ['copilot', ['-i', prompt]],
    ['qwen', ['-i', prompt]]
  ] as const)('builds atomic %s initial-prompt arguments', (provider, expected) => {
    expect(buildInitialPromptArguments(provider, prompt)).toEqual(expected);
  });

  it('rejects launch-only providers and invalid prompts', () => {
    expect(() => buildInitialPromptArguments('aider', prompt)).toThrow(
      'does not support cross-agent handoff'
    );
    expect(() => buildInitialPromptArguments('codex', 'bad\nprompt')).toThrow(
      'invalid'
    );
  });
});
