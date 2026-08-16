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
