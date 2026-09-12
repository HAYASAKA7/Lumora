import { describe, expect, it, vi } from 'vitest';

import { chooseAgentFiles } from './choose-agent-files';

describe('chooseAgentFiles', () => {
  it('asks for files, several at once, under a name the user can read', async () => {
    const showOpenDialog = vi.fn(async () => ({ canceled: true, filePaths: [] }));

    await chooseAgentFiles(showOpenDialog);

    expect(showOpenDialog).toHaveBeenCalledWith({
      title: 'Choose files for the agent',
      properties: ['openFile', 'multiSelections']
    });
  });

  it('returns each chosen file with the name it shows in the composer', async () => {
    const result = await chooseAgentFiles(async () => ({
      canceled: false,
      filePaths: ['/work/notes.md', '/work/logs/run.log']
    }));

    expect(result).toEqual({
      files: [
        { name: 'notes.md', path: '/work/notes.md' },
        { name: 'run.log', path: '/work/logs/run.log' }
      ]
    });
  });

  it('returns nothing when the user closes the dialog', async () => {
    const result = await chooseAgentFiles(async () => ({
      canceled: true,
      filePaths: ['/work/notes.md']
    }));

    expect(result).toEqual({ files: [] });
  });

  it('takes only as many files as one message carries, and skips empty paths', async () => {
    const result = await chooseAgentFiles(async () => ({
      canceled: false,
      filePaths: ['', ...Array.from({ length: 9 }, (_, index) => `/work/file-${index}.txt`)]
    }));

    expect(result.files).toHaveLength(8);
    expect(result.files[0]).toEqual({ name: 'file-0.txt', path: '/work/file-0.txt' });
  });
});
