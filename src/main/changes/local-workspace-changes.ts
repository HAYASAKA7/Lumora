import { DatabaseSync } from 'node:sqlite';

import type { ChangesCount } from '../../shared/changes';
import { migrateCatalogDatabase } from '../storage/migrations';
import { TerminalRepository } from '../storage/terminal-repository';
import { ChangesRepository } from './changes-repository';
import { createGitLocator } from './git-locator';
import { GitCommandError, runGit as defaultRunGit, type RunGit } from './git-runner';
import {
  WorkspaceChangesService,
  type ChangesOperation
} from './workspace-changes-service';
import { WorkspaceSnapshotEngine } from './workspace-snapshot-engine';

export interface LocalWorkspaceChangesOptions {
  databasePath: string;
  /** Where the snapshot object stores live, outside every workspace. */
  storeRoot: string;
  /** Finds git on this computer, when tracking needs it; see createGitLocator. */
  locateGit(): Promise<string | null>;
  platform: NodeJS.Platform;
  onCount(count: ChangesCount): void;
  openPath(path: string): Promise<string>;
  showItemInFolder(path: string): void;
  reportError?(operation: ChangesOperation, error: unknown): void;
  runGit?: RunGit;
}

/** The name the engine is built with; never run, since every call is given the path git was found at. */
const UNRESOLVED_GIT = 'git';

/**
 * Runs git only from the absolute path it was found at. A bare name would let
 * Windows pick up a git.exe from inside the workspace it runs in.
 */
export function runGitFromResolvedPath(
  runGit: RunGit,
  resolveGitPath: () => Promise<string | null>
): RunGit {
  return async (options) => {
    const gitPath = await resolveGitPath();
    if (gitPath === null) {
      throw new GitCommandError('unavailable');
    }
    return runGit({ ...options, gitPath });
  };
}

export interface LocalWorkspaceChanges {
  readonly service: WorkspaceChangesService;
  /** Stops the refresh timer and closes the database; call after every session has ended. */
  close(): void;
}

/**
 * Change tracking for sessions on this computer, or null when this computer
 * cannot run it. A store that will not open leaves the application running
 * with the feature unavailable rather than failing to start.
 */
export async function startLocalWorkspaceChanges(
  options: LocalWorkspaceChangesOptions
): Promise<LocalWorkspaceChanges | null> {
  try {
    return await createLocalWorkspaceChanges(options);
  } catch (error) {
    options.reportError?.('startup', error);
    return null;
  }
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
  const resolveGitPath = createGitLocator({ locate: options.locateGit, platform: options.platform });
  const service = new WorkspaceChangesService({
    repository: new ChangesRepository(database),
    engine: new WorkspaceSnapshotEngine({
      gitPath: UNRESOLVED_GIT,
      storeRoot: options.storeRoot,
      runGit: runGitFromResolvedPath(runGit, resolveGitPath)
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
