import { describe, expect, it } from 'vitest';

import {
  ChangesCountListSchema,
  ChangesFileDiffRequestSchema,
  ChangesHistoryRequestSchema,
  ChangesOpenRequestSchema,
  ChangesReviewRequestSchema,
  ChangesSourceSchema
} from './changes';

describe('workspace changes contracts', () => {
  it('parses the three change sources', () => {
    const sources = [
      { kind: 'session', ownerId: 'runtime_1-a', view: 'session' },
      { kind: 'workspace', workspaceId: 'workspace-1' },
      { kind: 'review', reviewId: 'review-1' }
    ] as const;
    for (const source of sources) {
      expect(ChangesSourceSchema.parse(source)).toEqual(source);
    }
  });

  it('rejects an unsafe owner id', () => {
    expect(ChangesSourceSchema.safeParse({ kind: 'session', ownerId: '../etc', view: 'session' }).success).toBe(false);
    expect(ChangesReviewRequestSchema.safeParse({ ownerId: 'a b', files: [{ path: 'file.ts' }] }).success).toBe(false);
  });

  it('rejects a review request without files', () => {
    expect(ChangesReviewRequestSchema.safeParse({ ownerId: 'runtime-1', files: [] }).success).toBe(false);
    expect(ChangesReviewRequestSchema.parse({ ownerId: 'runtime-1', files: [{ path: 'a.ts' }] })).toEqual({
      ownerId: 'runtime-1', files: [{ placeId: null, path: 'a.ts' }]
    });
  });

  it('bounds the other requests', () => {
    const source = { kind: 'workspace', workspaceId: 'workspace-1' } as const;
    expect(ChangesFileDiffRequestSchema.safeParse({ source, path: '' }).success).toBe(false);
    expect(ChangesHistoryRequestSchema.safeParse({ workspaceId: 'Upper' }).success).toBe(false);
    expect(ChangesOpenRequestSchema.safeParse({ source, path: 'a.ts', action: 'delete' }).success).toBe(false);
    expect(ChangesCountListSchema.safeParse(Array.from({ length: 257 }, () => ({
      ownerId: 'runtime-1', workspaceId: 'workspace-1', state: 'ready', changedFileCount: 0
    }))).success).toBe(false);
  });
});
