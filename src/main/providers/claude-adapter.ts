import {
  createProviderAdapter,
  type ProviderAdapter,
  type ProviderScanDependencies
} from './provider-adapter';

export function createClaudeAdapter(
  dependencies: ProviderScanDependencies
): ProviderAdapter {
  return createProviderAdapter(
    { provider: 'claude', displayName: 'Claude Code', command: 'claude' },
    dependencies
  );
}
