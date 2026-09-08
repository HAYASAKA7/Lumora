import { availableParallelism } from 'node:os';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

import { resolveTestTimeouts } from './src/shared/test-runner-config';

const LOCAL_TEST_MAX_WORKERS = 3;

export function resolveTestMaxWorkers(
  ci: string | undefined,
  parallelism: number
): number | undefined {
  if (ci) return undefined;

  const safeParallelism = Number.isFinite(parallelism)
    ? Math.max(1, Math.floor(parallelism))
    : 1;

  return Math.max(
    1,
    Math.min(LOCAL_TEST_MAX_WORKERS, Math.floor(safeParallelism / 2))
  );
}

const maxWorkers = resolveTestMaxWorkers(
  process.env.CI,
  availableParallelism()
);

/**
 * Timeouts belong to each project: a project does not inherit the root test
 * options, so setting them once at the root left every project on Vitest's
 * own five seconds.
 */
const timeouts = resolveTestTimeouts(process.env.CI);

export default defineConfig({
  test: {
    ...(maxWorkers === undefined ? {} : { maxWorkers }),
    projects: [
      {
        test: {
          ...timeouts,
          name: 'node',
          environment: 'node',
          include: [
            'src/{main,preload,shared}/**/*.test.ts',
            'scripts/localization/**/*.test.ts'
          ]
        }
      },
      {
        plugins: [react()],
        test: {
          ...timeouts,
          name: 'renderer',
          environment: 'jsdom',
          include: ['src/renderer/**/*.test.tsx'],
          setupFiles: ['src/renderer/src/test-setup.ts']
        }
      }
    ]
  }
});
