import { describe, expect, it } from 'vitest';

import { PROVIDER_IDS } from '../../shared/contracts';
import { createProviderPolicy } from './provider-policy';

describe('ProviderPolicy', () => {
  it('replaces enabled providers in canonical order and returns snapshots', () => {
    const policy = createProviderPolicy(['claude', 'codex']);

    expect(policy.providers()).toEqual(['codex', 'claude']);
    const first = policy.providers() as string[];
    first.push('gemini');
    expect(policy.providers()).toEqual(['codex', 'claude']);

    policy.replace(['qwen', 'codex']);
    expect(policy.providers()).toEqual(['codex', 'qwen']);
    expect(policy.isEnabled('claude')).toBe(false);
    expect(policy.isEnabled('qwen')).toBe(true);
  });

  it('defaults to every supported provider and rejects an empty replacement', () => {
    const policy = createProviderPolicy();

    expect(policy.providers()).toEqual(PROVIDER_IDS);
    expect(() => policy.replace([])).toThrow('enabled provider');
    expect(policy.providers()).toEqual(PROVIDER_IDS);
  });
});
