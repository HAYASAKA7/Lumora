import type { RuntimeState } from '../../shared/contracts';

type RuntimeStateLike = Readonly<{ state: RuntimeState }>;

export function isActiveTerminalRuntime(runtime: RuntimeStateLike): boolean {
  return runtime.state === 'launching' || runtime.state === 'running';
}

export function countActiveTerminalRuntimes(
  runtimes: readonly RuntimeStateLike[]
): number {
  return runtimes.filter(isActiveTerminalRuntime).length;
}

type StructuredRuntimeStateLike = Readonly<{
  state: 'starting' | 'ready' | 'reconnecting' | 'closing' | 'closed' | 'failed';
}>;

export function isActiveStructuredRuntime(runtime: StructuredRuntimeStateLike): boolean {
  return runtime.state === 'starting' ||
    runtime.state === 'ready' ||
    runtime.state === 'reconnecting' ||
    runtime.state === 'closing';
}

export function countActiveStructuredRuntimes(
  runtimes: readonly StructuredRuntimeStateLike[]
): number {
  return runtimes.filter(isActiveStructuredRuntime).length;
}
