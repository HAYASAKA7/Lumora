import {
  WorkspaceVisibilityRestoreRequestSchema,
  WorkspaceVisibilitySetRequestSchema,
  type WorkspaceVisibilityPolicy,
  type WorkspaceVisibilityRestoreRequest,
  type WorkspaceVisibilitySetRequest
} from '../../shared/contracts';
import type { WorkspaceVisibilityRepository } from '../storage/workspace-visibility-repository';

interface WorkspaceVisibilityServiceOptions {
  repository: Pick<
    WorkspaceVisibilityRepository,
    'list' | 'set' | 'restore' | 'restoreAll'
  >;
  clock?: () => Date;
}

export class WorkspaceVisibilityService {
  private readonly repository: WorkspaceVisibilityServiceOptions['repository'];
  private readonly clock: () => Date;

  constructor({
    repository,
    clock = () => new Date()
  }: WorkspaceVisibilityServiceOptions) {
    this.repository = repository;
    this.clock = clock;
  }

  getPolicies(): WorkspaceVisibilityPolicy[] {
    return this.repository.list();
  }

  setPolicy(input: WorkspaceVisibilitySetRequest): WorkspaceVisibilityPolicy[] {
    const request = WorkspaceVisibilitySetRequestSchema.parse(input);
    return this.repository.set(request, this.clock().toISOString());
  }

  restorePolicies(
    input: WorkspaceVisibilityRestoreRequest
  ): WorkspaceVisibilityPolicy[] {
    const request = WorkspaceVisibilityRestoreRequestSchema.parse(input);
    return this.repository.restore(request.workspaceIds);
  }

  restoreAll(): WorkspaceVisibilityPolicy[] {
    return this.repository.restoreAll();
  }
}
