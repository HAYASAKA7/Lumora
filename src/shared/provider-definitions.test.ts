import { describe, expect, it } from 'vitest';

import {
  PROVIDER_DEFINITIONS,
  SESSION_PROVIDER_IDS,
  hasCompleteSessionSupport,
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
      sessionSupport: 'complete'
    });
    expect(providerDefinition('antigravity')).toMatchObject({
      command: 'agy',
      npmPackage: null
    });
  });

  it('requires discovery and exact resume for complete session support', () => {
    expect(SESSION_PROVIDER_IDS).toEqual([
      'codex',
      'claude',
      'gemini',
      'opencode',
      'copilot',
      'qwen'
    ]);
    expect(hasCompleteSessionSupport('gemini')).toBe(true);
    expect(hasCompleteSessionSupport('cursor')).toBe(false);
    expect(
      PROVIDER_DEFINITIONS
        .filter(({ sessionSupport }) => sessionSupport === 'launch_only')
        .map(({ provider }) => provider)
    ).toEqual(['antigravity', 'cursor', 'amp', 'crush', 'goose', 'aider']);
  });
});
