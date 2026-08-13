import {
  DeveloperEnvironmentScanResultSchema,
  type DeveloperEnvironmentScanResult,
  type DeveloperToolStatus
} from '../../shared/contracts';

interface DeveloperEnvironmentDependencies {
  findExecutable(command: string): Promise<string | null>;
  probeVersion(executablePath: string): Promise<string>;
}

type Clock = () => Date;

interface EnvironmentScanMeasurement {
  outcome: 'succeeded' | 'failed';
  durationMs: number;
  cacheHits: number;
}

interface EnvironmentScannerOptions {
  monotonicClock?: () => number;
  onSettled?: (measurement: EnvironmentScanMeasurement) => void;
}

interface ActiveEnvironmentScan {
  promise: Promise<DeveloperEnvironmentScanResult>;
  cacheHits: number;
}

async function scanTool(
  command: 'node' | 'npm',
  dependencies: DeveloperEnvironmentDependencies
): Promise<DeveloperToolStatus> {
  const executablePath = await dependencies.findExecutable(command);
  if (executablePath === null) {
    return { state: 'not_found', executablePath: null, version: null };
  }

  try {
    return {
      state: 'ready',
      executablePath,
      version: await dependencies.probeVersion(executablePath)
    };
  } catch {
    return { state: 'probe_failed', executablePath, version: null };
  }
}

export function createDeveloperEnvironmentScanner(
  dependencies: DeveloperEnvironmentDependencies,
  now: Clock = () => new Date(),
  options: EnvironmentScannerOptions = {}
) {
  const monotonicClock = options.monotonicClock ?? (() => performance.now());
  let active: ActiveEnvironmentScan | null = null;

  const performScan = async (): Promise<DeveloperEnvironmentScanResult> => {
    const [node, npm] = await Promise.all([
      scanTool('node', dependencies),
      scanTool('npm', dependencies)
    ]);

    return DeveloperEnvironmentScanResultSchema.parse({
      checkedAt: now().toISOString(),
      node,
      npm
    });
  };

  return Object.freeze({
    scan(): Promise<DeveloperEnvironmentScanResult> {
      if (active !== null) {
        active.cacheHits += 1;
        return active.promise;
      }
      const startedAt = monotonicClock();
      let entry!: ActiveEnvironmentScan;
      const promise = (async () => {
        let outcome: EnvironmentScanMeasurement['outcome'] = 'succeeded';
        try {
          return await performScan();
        } catch (error) {
          outcome = 'failed';
          throw error;
        } finally {
          const durationMs = Math.max(
            0,
            Math.min(86_400_000, Math.round(monotonicClock() - startedAt))
          );
          try {
            options.onSettled?.({
              outcome,
              durationMs,
              cacheHits: entry.cacheHits
            });
          } catch {
            // Measurement consumers cannot change discovery behavior.
          }
          if (active === entry) active = null;
        }
      })();
      entry = { promise, cacheHits: 0 };
      active = entry;
      return promise;
    }
  });
}
