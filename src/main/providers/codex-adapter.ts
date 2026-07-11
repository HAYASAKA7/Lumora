import {
  createProviderAdapter,
  type ProviderAdapter,
  type ProviderScanDependencies
} from './provider-adapter';

export function createCodexAdapter(
  dependencies: ProviderScanDependencies
): ProviderAdapter {
  return createProviderAdapter(
    { provider: 'codex', displayName: 'Codex', command: 'codex' },
    dependencies
  );
}
