import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const LOCAL_TEST_MAX_WORKERS = 6;

export function resolveTestMaxWorkers(
  ci: string | undefined
): number | undefined {
  return ci ? undefined : LOCAL_TEST_MAX_WORKERS;
}

const maxWorkers = resolveTestMaxWorkers(process.env.CI);

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
