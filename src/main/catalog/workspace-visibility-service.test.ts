import { describe, expect, it, vi } from 'vitest';

import { WorkspaceVisibilityService } from './workspace-visibility-service';

const WORKSPACE_ID = 'a'.repeat(64);
const POLICY = {
  workspaceId: WORKSPACE_ID,
  mode: 'workspace_only' as const,
  updatedAt: '2026-08-12T01:00:00.000Z'
};

describe('WorkspaceVisibilityService', () => {
  it('returns the complete policy list after every mutation', () => {
    const repository = {
      list: vi.fn(() => [POLICY]),
      set: vi.fn(() => [POLICY]),
      restore: vi.fn(() => []),
      restoreAll: vi.fn(() => [])
    };
    const service = new WorkspaceVisibilityService({
      repository,
      clock: () => new Date(POLICY.updatedAt)
    });

    expect(service.getPolicies()).toEqual([POLICY]);
    expect(service.setPolicy({
      workspaceId: WORKSPACE_ID,
      mode: 'workspace_only'
    })).toEqual([POLICY]);
    expect(repository.set).toHaveBeenCalledWith(
      { workspaceId: WORKSPACE_ID, mode: 'workspace_only' },
      POLICY.updatedAt
    );
    expect(service.restorePolicies({ workspaceIds: [WORKSPACE_ID] })).toEqual([]);
    expect(repository.restore).toHaveBeenCalledWith([WORKSPACE_ID]);
    expect(service.restoreAll()).toEqual([]);
  });
});
