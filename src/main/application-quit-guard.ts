import {
  ApplicationQuitRequestSchema,
  ApplicationQuitResolutionSchema,
  type ApplicationQuitRequest,
  type ApplicationQuitResolution
} from '../shared/contracts';

interface CreateApplicationQuitGuardOptions {
  sendRequest(request: ApplicationQuitRequest): boolean;
}

interface ApplicationQuitRequestInput {
  warn: boolean;
  counts: ApplicationQuitRequest;
}

export function createApplicationQuitGuard({
  sendRequest
}: CreateApplicationQuitGuardOptions) {
  let pending = false;

  return {
    request({ warn, counts }: ApplicationQuitRequestInput): 'proceed' | 'pending' {
      const request = ApplicationQuitRequestSchema.parse(counts);
      if (!warn || request.totalActiveAgentCount === 0) return 'proceed';
      if (pending) return 'pending';
      if (!sendRequest(request)) return 'proceed';
      pending = true;
      return 'pending';
    },
    resolve(resolution: ApplicationQuitResolution): boolean {
      ApplicationQuitResolutionSchema.parse(resolution);
      if (!pending) return false;
      pending = false;
      return true;
    }
  };
}
