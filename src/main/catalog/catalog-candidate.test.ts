import { describe, expect, it } from 'vitest';

import { CatalogCandidateSchema } from './catalog-candidate';

function candidate(createdAt: string, updatedAt: string) {
  return {
    provider: 'claude',
    nativeId: 'remote-session-1',
    workspace: {
      id: 'a'.repeat(64),
      canonicalPath: '/work/lumora',
      identityKey: '/work/lumora',
      displayName: 'lumora',
      available: true
    },
    title: 'Remote session',
    createdAt,
    updatedAt,
    lifetimeTokens: null,
    source: { key: 'remote:session-1', fingerprint: null }
  };
}

describe('CatalogCandidateSchema', () => {
  it('orders equivalent ISO formats by time rather than their encoded text', () => {
    const value = candidate(
      '2026-08-10T03:00:00Z',
      '2026-08-10T03:00:00.100Z'
    );

    expect(CatalogCandidateSchema.safeParse(value).success).toBe(true);
  });

  it('rejects creation timestamps that are chronologically after updates', () => {
    const value = candidate(
      '2026-08-10T03:00:01Z',
      '2026-08-10T03:00:00.999Z'
    );

    expect(CatalogCandidateSchema.safeParse(value).success).toBe(false);
  });
});
