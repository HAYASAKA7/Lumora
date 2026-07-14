import { mkdirSync } from 'node:fs';

interface DataPathApp {
  readonly isPackaged: boolean;
  getPath(name: 'userData'): string;
  setPath(name: 'userData' | 'sessionData', path: string): void;
}

type EnsureDirectory = (path: string) => void;

export function toDevelopmentDataPath(defaultUserDataPath: string): string {
  return defaultUserDataPath.endsWith('-dev')
    ? defaultUserDataPath
    : `${defaultUserDataPath}-dev`;
}

export function configureDevelopmentDataPaths(
  app: DataPathApp,
  ensureDirectory: EnsureDirectory = (path) =>
    mkdirSync(path, { recursive: true })
): void {
  if (app.isPackaged) {
    return;
  }

  const developmentPath = toDevelopmentDataPath(app.getPath('userData'));
  ensureDirectory(developmentPath);
  app.setPath('userData', developmentPath);
  app.setPath('sessionData', developmentPath);
}
