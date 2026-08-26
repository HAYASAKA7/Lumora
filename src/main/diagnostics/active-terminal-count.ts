import type { RuntimeState } from '../../shared/contracts';

type RuntimeStateLike = Readonly<{ state: RuntimeState }>;

export function countActiveTerminalRuntimes(
  runtimes: readonly RuntimeStateLike[]
): number {
  return runtimes.reduce(
    (count, runtime) => (
      runtime.state === 'launching' || runtime.state === 'running'
        ? count + 1
        : count
    ),
    0
  );
}

type StructuredRuntimeStateLike = Readonly<{
  state: 'starting' | 'ready' | 'reconnecting' | 'closing' | 'closed' | 'failed';
}>;

export function countActiveStructuredRuntimes(
  runtimes: readonly StructuredRuntimeStateLike[]
): number {
  return runtimes.reduce(
    (count, runtime) => (
      runtime.state === 'starting' ||
      runtime.state === 'ready' ||
      runtime.state === 'reconnecting' ||
      runtime.state === 'closing'
        ? count + 1
        : count
    ),
    0
  );
}
