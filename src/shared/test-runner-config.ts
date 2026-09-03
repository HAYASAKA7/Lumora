const LOCAL_ASYNC_UTIL_TIMEOUT_MS = 1_000;
const CI_ASYNC_UTIL_TIMEOUT_MS = 5_000;
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
 * markup that explains it.
 */
export function resolveTestTimeouts(
  ci: string | undefined
): { testTimeout?: number; hookTimeout?: number } {
  return ci
    ? { testTimeout: CI_TEST_TIMEOUT_MS, hookTimeout: CI_TEST_TIMEOUT_MS }
    : {};
}
