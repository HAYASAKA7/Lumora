import { DatabaseSync } from 'node:sqlite';

import type { ChangesCount } from '../../shared/changes';
import { migrateCatalogDatabase } from '../storage/migrations';
import { TerminalRepository } from '../storage/terminal-repository';
import { ChangesRepository } from './changes-repository';
import { runGit as defaultRunGit, type RunGit } from './git-runner';
import {
  WorkspaceChangesService,
  type ChangesOperation
} from './workspace-changes-service';
import { WorkspaceSnapshotEngine } from './workspace-snapshot-engine';

export interface LocalWorkspaceChangesOptions {
  databasePath: string;
  /** Where the snapshot object stores live, outside every workspace. */
  storeRoot: string;
  /** Finds git on this computer; asked once, when tracking first needs it. */
  locateGit(): Promise<string | null>;
  onCount(count: ChangesCount): void;
  openPath(path: string): Promise<string>;
  showItemInFolder(path: string): void;
  reportError?(operation: ChangesOperation, error: unknown): void;
  runGit?: RunGit;
}

export interface LocalWorkspaceChanges {
  readonly service: WorkspaceChangesService;
  /** Stops the refresh timer and closes the database; call after every session has ended. */
  close(): void;
}

/**
 * Change tracking for sessions on this computer. Ends the segments the last
 * run left open, so it must be created before any local session launches.
 */
export async function createLocalWorkspaceChanges(
  options: LocalWorkspaceChangesOptions
): Promise<LocalWorkspaceChanges> {
  const database = new DatabaseSync(options.databasePath);
  try {
    migrateCatalogDatabase(database);
  } catch (error) {
    database.close();
    throw error;
  }
  const workspaces = new TerminalRepository(database);
  const runGit = options.runGit ?? defaultRunGit;
  let gitPath: Promise<string | null> | null = null;
  const resolveGitPath = (): Promise<string | null> => {
    gitPath ??= options.locateGit().catch(() => null);
    return gitPath;
  };
  const service = new WorkspaceChangesService({
    repository: new ChangesRepository(database),
    engine: new WorkspaceSnapshotEngine({
      gitPath: 'git',
      storeRoot: options.storeRoot,
      runGit: async (gitOptions) =>
        runGit({ ...gitOptions, gitPath: (await resolveGitPath()) ?? gitOptions.gitPath })
    }),
    lookupWorkspace: (workspaceId) => workspaces.getWorkspace(workspaceId),
    gitAvailable: async () => (await resolveGitPath()) !== null,
    onCount: options.onCount,
    openPath: options.openPath,
    showItemInFolder: options.showItemInFolder,
    ...(options.reportError === undefined ? {} : { reportError: options.reportError })
  });
  try {
    await service.startup();
  } catch (error) {
    database.close();
    throw error;
  }
  service.startTerminalTimer();
  let closed = false;
  return {
    service,
    close() {
      if (closed) return;
      closed = true;
      service.dispose();
      database.close();
    }
  };
}
