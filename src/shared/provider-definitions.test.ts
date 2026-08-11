import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  PROVIDER_DEFINITIONS,
  SESSION_PROVIDER_IDS,
  hasCompleteSessionSupport,
  hasNativeForkSupport,
  hasVerifiedStartPromptSupport,
  nativeForkMinimumVersion,
  providerDefinition,
  supportsNativeForkVersion
} from './provider-definitions';

describe('provider definitions', () => {
  it('keeps helper probe commands in one canonical registry', () => {
    const registryPath = resolve('src/shared/provider-probes.json');
    expect(existsSync(registryPath)).toBe(true);
    if (!existsSync(registryPath)) return;

    const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as Array<{
      provider: string;
      command: string;
      versionArgs: string[];
      npmPackage: string | null;
    }>;
    expect(registry).toEqual(PROVIDER_DEFINITIONS.map((definition) => ({
      provider: definition.provider,
      command: definition.command,
      versionArgs: [...definition.versionArgs],
      npmPackage: definition.npmPackage
    })));
  });

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

  it('exposes start prompts only for verified interactive providers', () => {
    expect(
      PROVIDER_DEFINITIONS
        .filter(({ provider }) => hasVerifiedStartPromptSupport(provider))
        .map(({ provider }) => provider)
    ).toEqual(['codex', 'claude', 'gemini', 'opencode', 'copilot', 'qwen']);
    expect(hasVerifiedStartPromptSupport('codex')).toBe(true);
    expect(hasVerifiedStartPromptSupport('qwen')).toBe(true);
    expect(hasVerifiedStartPromptSupport('cursor')).toBe(false);
    expect(hasVerifiedStartPromptSupport('aider')).toBe(false);
  });

  it('exposes native fork support only for providers with stable launch commands', () => {
    expect(
      PROVIDER_DEFINITIONS
        .filter(({ provider }) => hasNativeForkSupport(provider))
        .map(({ provider }) => provider)
    ).toEqual(['codex', 'claude', 'opencode']);
    expect(hasNativeForkSupport('gemini')).toBe(false);
    expect(hasNativeForkSupport('copilot')).toBe(false);
    expect(hasNativeForkSupport('qwen')).toBe(false);
    expect(hasNativeForkSupport('aider')).toBe(false);
  });

  it.each([
    ['codex', 'codex-cli 0.120.0', '0.119.9'],
    ['claude', '1.0.90 (Claude Code)', '1.0.89'],
    ['opencode', 'opencode 1.0.0', '0.9.99']
  ] as const)(
    'requires a tested %s CLI version for native fork',
    (provider, supported, unsupported) => {
      expect(supportsNativeForkVersion(provider, supported)).toBe(true);
      expect(supportsNativeForkVersion(provider, unsupported)).toBe(false);
    }
  );

  it('accepts newer native-fork versions and rejects unverifiable versions', () => {
    expect(supportsNativeForkVersion('codex', 'codex-cli 0.145.0')).toBe(true);
    expect(supportsNativeForkVersion('claude', '2.1.212 (Claude Code)')).toBe(
      true
    );
    expect(supportsNativeForkVersion('opencode', '1.18.4')).toBe(true);
    expect(supportsNativeForkVersion('codex', null)).toBe(false);
    expect(supportsNativeForkVersion('codex', 'nightly')).toBe(false);
    expect(supportsNativeForkVersion('gemini', '99.0.0')).toBe(false);
  });

  it('publishes the tested minimum versions for provider guidance', () => {
    expect(nativeForkMinimumVersion('codex')).toBe('0.120.0');
    expect(nativeForkMinimumVersion('claude')).toBe('1.0.90');
    expect(nativeForkMinimumVersion('opencode')).toBe('1.0.0');
    expect(nativeForkMinimumVersion('gemini')).toBeNull();
  });
});
