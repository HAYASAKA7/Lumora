import { describe, expect, it } from 'vitest';

import {
  buildForkArguments,
  buildManagedHandoffArguments,
  buildNewArguments,
  buildResumeArguments
} from './launch-command';

describe('buildResumeArguments', () => {
  it('builds Kimi Code exact resume without claiming prompt support', () => {
    expect(buildNewArguments('kimi', '')).toEqual([]);
    expect(buildResumeArguments('kimi', 'session_123')).toEqual([
      '--session',
      'session_123'
    ]);
    expect(() => buildNewArguments('kimi', 'inspect this')).toThrow(
      'Kimi Code does not support a start prompt in Lumora.'
    );
    expect(() => buildResumeArguments('kimi', 'session_123', 'continue')).toThrow(
      'Kimi Code does not support a start prompt in Lumora.'
    );
  });

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
  it.each([
    ['codex', ['resume', 'native-1', 'Fix tests']],
    ['claude', ['--resume', 'native-1', 'Fix tests']],
    ['gemini', ['--resume', 'native-1', '--prompt-interactive=Fix tests']],
    ['opencode', ['--session', 'native-1', '--prompt=Fix tests']],
    ['copilot', ['--session-id', 'native-1', '--interactive=Fix tests']],
    ['qwen', ['--resume', 'native-1', '--prompt-interactive=Fix tests']]
  ] as const)(
    'builds atomic prompted %s resume arguments',
    (provider, expected) => {
      expect(buildResumeArguments(provider, 'native-1', 'Fix tests')).toEqual(
        expected
      );
    }
  );

  it('normalizes a whitespace-only resume prompt to promptless arguments', () => {
    expect(buildResumeArguments('codex', 'native-1', '   ')).toEqual([
      'resume',
      'native-1'
    ]);
  });

  it.each([
    ['codex', ['resume', 'native-1', '--', '--help']],
    ['claude', ['--resume', 'native-1', '--', '--help']],
    ['gemini', ['--resume', 'native-1', '--prompt-interactive=--help']],
    ['opencode', ['--session', 'native-1', '--prompt=--help']],
    ['copilot', ['--session-id', 'native-1', '--interactive=--help']],
    ['qwen', ['--resume', 'native-1', '--prompt-interactive=--help']]
  ] as const)(
    'protects an option-like prompt for %s resume',
    (provider, expected) => {
      expect(buildResumeArguments(provider, 'native-1', '--help')).toEqual(
        expected
      );
    }
  );
});

describe('buildNewArguments', () => {
  const prompt = 'Read the Lumora handoff context.';

  it.each([
    'codex',
    'claude',
    'gemini',
    'opencode',
    'copilot',
    'qwen',
    'antigravity',
    'cursor',
    'amp',
    'crush',
    'goose',
    'aider'
  ] as const)('keeps a blank %s launch promptless', (provider) => {
    expect(buildNewArguments(provider, '')).toEqual([]);
    expect(buildNewArguments(provider, '   ')).toEqual([]);
  });

  it.each([
    ['codex', [prompt]],
    ['claude', [prompt]],
    ['gemini', [`--prompt-interactive=${prompt}`]],
    ['opencode', [`--prompt=${prompt}`]],
    ['copilot', [`--interactive=${prompt}`]],
    ['qwen', [`--prompt-interactive=${prompt}`]]
  ] as const)('builds atomic %s start-prompt arguments', (provider, expected) => {
    expect(buildNewArguments(provider, prompt)).toEqual(expected);
  });

  it('rejects launch-only providers and invalid prompts', () => {
    expect(() => buildNewArguments('aider', prompt)).toThrow(
      'does not support a start prompt'
    );
    expect(() => buildNewArguments('codex', 'bad\nprompt')).toThrow(
      'invalid'
    );
  });

  it.each([
    ['codex', ['--', '--help']],
    ['claude', ['--', '--help']],
    ['gemini', ['--prompt-interactive=--help']],
    ['opencode', ['--prompt=--help']],
    ['copilot', ['--interactive=--help']],
    ['qwen', ['--prompt-interactive=--help']]
  ] as const)(
    'protects an option-like prompt for a new %s session',
    (provider, expected) => {
      expect(buildNewArguments(provider, '--help')).toEqual(expected);
    }
  );

  it('keeps the user prompt limit while accepting a larger managed handoff prompt', () => {
    const managedPrompt = 'x'.repeat(5_000);
    expect(() => buildNewArguments('codex', managedPrompt)).toThrow(
      'start prompt is invalid'
    );
    expect(buildManagedHandoffArguments('codex', managedPrompt)).toEqual([
      managedPrompt
    ]);
    expect(() =>
      buildManagedHandoffArguments('codex', 'x'.repeat(8_193))
    ).toThrow('managed handoff prompt is invalid');
  });
});

describe('buildForkArguments', () => {
  const startPrompt = 'Review the failing tests and fix the root cause.';

  it.each([
    ['codex', ['fork', 'native-1', startPrompt]],
    ['claude', ['--resume', 'native-1', '--fork-session', startPrompt]],
    ['opencode', ['--session', 'native-1', '--fork', `--prompt=${startPrompt}`]]
  ] as const)('builds atomic %s native-fork arguments', (provider, expected) => {
    expect(buildForkArguments(provider, 'native-1', startPrompt)).toEqual(expected);
  });

  it.each([
    ['codex', ['fork', 'native-1']],
    ['claude', ['--resume', 'native-1', '--fork-session']],
    ['opencode', ['--session', 'native-1', '--fork']]
  ] as const)(
    'builds promptless %s native-fork arguments',
    (provider, expected) => {
      expect(buildForkArguments(provider, 'native-1', '')).toEqual(expected);
      expect(buildForkArguments(provider, 'native-1', '   ')).toEqual(expected);
    }
  );

  it.each([
    'gemini',
    'antigravity',
    'cursor',
    'copilot',
    'qwen',
    'amp',
    'crush',
    'goose',
    'aider'
  ] as const)('rejects unsupported provider %s', (provider) => {
    expect(() => buildForkArguments(provider, 'native-1', startPrompt)).toThrow(
      'does not support native session fork in Lumora'
    );
  });

  it.each([
    'line one\nline two',
    'line one\rline two',
    'bad\0task',
    'x'.repeat(4_097)
  ])('rejects invalid start prompt %#', (invalidStartPrompt) => {
    expect(() => buildForkArguments('codex', 'native-1', invalidStartPrompt)).toThrow(
      'start prompt is invalid'
    );
  });

  it.each(['', '   ', 'bad\nid', 'bad\0id', 'x'.repeat(257)])(
    'rejects invalid native session identity %#',
    (nativeId) => {
      expect(() => buildForkArguments('codex', nativeId, startPrompt)).toThrow(
        'native session identity is invalid'
      );
    }
  );

  it.each([
    ['codex', ['fork', 'native-1', '--', '--help']],
    ['claude', ['--resume', 'native-1', '--fork-session', '--', '--help']]
  ] as const)(
    'protects an option-like positional prompt for %s fork',
    (provider, expected) => {
      expect(buildForkArguments(provider, 'native-1', '--help')).toEqual(
        expected
      );
    }
  );
});
