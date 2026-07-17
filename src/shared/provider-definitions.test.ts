import { describe, expect, it } from 'vitest';

import {
  PROVIDER_DEFINITIONS,
  providerDefinition
} from './provider-definitions';

describe('provider definitions', () => {
  it('ships stable lifecycle metadata in UI order', () => {
    expect(PROVIDER_DEFINITIONS.map(({ provider }) => provider)).toEqual([
      'codex',
      'claude',
      'gemini',
      'antigravity',
      'opencode',
      'cursor',
      'copilot',
      'qwen',
      'amp',
      'crush',
      'goose',
      'aider'
    ]);
    expect(providerDefinition('gemini')).toMatchObject({
      displayName: 'Gemini CLI',
      command: 'gemini',
      npmPackage: '@google/gemini-cli',
      catalogSupport: false
    });
    expect(providerDefinition('antigravity')).toMatchObject({
      command: 'agy',
      npmPackage: null
    });
  });

  it('keeps saved-session catalog support limited to Codex and Claude Code', () => {
    expect(
      PROVIDER_DEFINITIONS
        .filter(({ catalogSupport }) => catalogSupport)
        .map(({ provider }) => provider)
    ).toEqual(['codex', 'claude']);
  });
});
