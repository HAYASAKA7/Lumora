import { basename } from 'node:path';

import {
  STRUCTURED_FILES_PER_MESSAGE,
  type StructuredFileChooseResult
} from '../../../shared/contracts';

interface OpenDialogSelection {
  canceled: boolean;
  filePaths: string[];
}

type ShowOpenDialog = (options: {
  title: string;
  properties: Array<'openFile' | 'multiSelections'>;
}) => Promise<OpenDialogSelection>;

/**
 * Asks the user which files a message should point the agent at.
 *
 * The main process owns the dialog, so the renderer never browses the disk: it
 * learns only the paths of what the user picked, and only as many as one
 * message can carry.
 */
export async function chooseAgentFiles(
  showOpenDialog: ShowOpenDialog
): Promise<StructuredFileChooseResult> {
  const selection = await showOpenDialog({
    title: 'Choose files for the agent',
    properties: ['openFile', 'multiSelections']
  });
  if (selection.canceled) return { files: [] };
  return {
    files: selection.filePaths
      .filter((path) => path.trim() !== '')
      .slice(0, STRUCTURED_FILES_PER_MESSAGE)
      .map((path) => ({ name: basename(path), path }))
  };
}
