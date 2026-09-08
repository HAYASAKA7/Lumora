const LOCAL_ASYNC_UTIL_TIMEOUT_MS = 1_000;
const CI_ASYNC_UTIL_TIMEOUT_MS = 5_000;
const LOCAL_TEST_TIMEOUT_MS = 15_000;
const CI_TEST_TIMEOUT_MS = 30_000;

/**
 * How long a Testing Library query waits before it gives up. The Windows runner
 * needs three to four times as long as Linux for this suite, so the default
 * second leaves no headroom there for work that normally finishes in
 * milliseconds. A query that resolves still returns immediately; only a query
 * that is going to fail waits longer.
 *
 * This module stays free of imports so the Vitest config and the renderer test
 * setup can both read it, the setup running inside jsdom where the config's own
 * build dependencies cannot load.
 */
export function resolveAsyncUtilTimeout(ci: string | undefined): number {
  return ci ? CI_ASYNC_UTIL_TIMEOUT_MS : LOCAL_ASYNC_UTIL_TIMEOUT_MS;
}

/**
 * A test has to outlive the query it is waiting on, otherwise a slow machine
 * reports an opaque test timeout instead of the query failure and the rendered
 * markup that explains it. Vitest's own five seconds is not enough for the
 * heaviest renderer tests while the rest of the suite runs beside them: one of
 * them was measured at 6992ms on a run where the whole suite took 146s, and it
 * failed with a bare timeout rather than anything about the test.
 */
export function resolveTestTimeouts(
  ci: string | undefined
): { testTimeout: number; hookTimeout: number } {
  const timeout = ci ? CI_TEST_TIMEOUT_MS : LOCAL_TEST_TIMEOUT_MS;
  return { testTimeout: timeout, hookTimeout: timeout };
}
