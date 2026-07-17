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
  now: Clock = () => new Date()
) {
  return Object.freeze({
    async scan(): Promise<DeveloperEnvironmentScanResult> {
      const [node, npm] = await Promise.all([
        scanTool('node', dependencies),
        scanTool('npm', dependencies)
      ]);

      return DeveloperEnvironmentScanResultSchema.parse({
        checkedAt: now().toISOString(),
        node,
        npm
      });
    }
  });
}
