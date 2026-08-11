import { availableParallelism } from 'node:os';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

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

export default defineConfig({
  test: {
    ...(maxWorkers === undefined ? {} : { maxWorkers }),
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/{main,preload,shared}/**/*.test.ts']
        }
      },
      {
        plugins: [react()],
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['src/renderer/**/*.test.tsx'],
          setupFiles: ['src/renderer/src/test-setup.ts']
        }
      }
    ]
  }
});
