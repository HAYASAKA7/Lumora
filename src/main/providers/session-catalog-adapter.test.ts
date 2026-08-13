import { describe, expect, it, vi } from 'vitest';

import type { ProviderId } from '../../shared/contracts';
import {
  createSessionCatalogRegistry,
  type SessionCatalogAdapter
} from './session-catalog-adapter';

function adapter(provider: ProviderId): SessionCatalogAdapter {
  return {
    provider,
    discover: vi.fn(),
    validateCompatibility: () => ({ compatible: true }),
    buildResumeArguments: (nativeId) => [nativeId],
    snapshotHandoff: vi.fn()
  };
}

describe('createSessionCatalogRegistry', () => {
  const complete = () => [
    adapter('codex'),
    adapter('claude'),
    adapter('gemini'),
    adapter('opencode'),
    adapter('copilot'),
    adapter('qwen'),
    adapter('kimi')
  ];

  it('keeps complete adapters in shared definition order', () => {
    const registry = createSessionCatalogRegistry(complete());
    expect(registry.providers()).toEqual([
      'codex',
      'claude',
      'gemini',
      'opencode',
      'copilot',
      'qwen',
      'kimi'
    ]);
    expect(registry.get('gemini')?.provider).toBe('gemini');
    expect(registry.get('aider')).toBeNull();
  });

  it('rejects duplicate, incomplete, and launch-only adapter sets', () => {
    const adapters = complete();
    expect(() =>
      createSessionCatalogRegistry([...adapters, adapters[0]!])
    ).toThrow('Duplicate session catalog adapter');
    expect(() => createSessionCatalogRegistry(adapters.slice(0, -1))).toThrow(
      'Missing session catalog adapter for kimi'
    );
    expect(() =>
      createSessionCatalogRegistry([...adapters, adapter('aider')])
    ).toThrow('Launch-only provider cannot register a session catalog adapter');
  });

  it('exposes typed compatibility validation on every complete adapter', () => {
    const registry = createSessionCatalogRegistry(complete());
    expect(
      registry.get('qwen')?.validateCompatibility({
        provider: 'qwen',
        displayName: 'Qwen Code',
        state: 'ready',
        executablePath: '/tools/qwen',
        version: 'qwen-code 0.19.11',
        issue: null
      })
    ).toEqual({ compatible: true });
    expect(registry.get('qwen')?.snapshotHandoff).toBeTypeOf('function');
  });
});
