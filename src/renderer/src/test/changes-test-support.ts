import { fireEvent, screen, within } from '@testing-library/react';
import { vi } from 'vitest';

import type {
  ChangedFile,
  ChangesCount,
  ChangesFileDiff,
  ChangesHistory,
  ChangesOpenAction,
  ChangesOpenOutcome,
  ChangesSource,
  ChangesSummary
} from '../../../shared/contracts';
import type { ChangesApi } from '../changes/useWorkspaceChanges';

export const sessionSource: ChangesSource = { kind: 'session', ownerId: 'r1', view: 'session' };
export const uncommittedSource: ChangesSource = { kind: 'session', ownerId: 'r1', view: 'uncommitted' };

/** The workspace itself, which every summary lists first. */
export const workspacePlaces = [
  { id: null, name: 'work', path: 'D:\work', baselineLate: false, unavailableReason: null }
];

export function changed(path: string, overrides: Partial<ChangedFile> = {}): ChangedFile {
  return { placeId: null, path, oldPath: null, status: 'modified', additions: 3, deletions: 1, binary: false, ...overrides };
}

export function summaryFor(source: ChangesSource, overrides: Partial<ChangesSummary> = {}): ChangesSummary {
  return {
    source,
    workspaceId: 'ws-1',
    state: 'ready',
    unavailableReason: null,
    baselineLate: false,
    sharedWorkspace: false,
    places: workspacePlaces,
    files: [],
    committed: [],
    truncated: false,
    checkedAt: '2026-09-15T00:00:00.000Z',
    ...overrides
  };
}

export const sessionSummary = summaryFor(sessionSource, {
  baselineLate: true,
  files: [changed('src/login.ts'), changed('src/new.ts', { status: 'added' })],
  committed: [changed('docs/readme.md')]
});

export function fakeChangesApi(summaries: (source: ChangesSource) => ChangesSummary = () => sessionSummary) {
  const listeners = new Set<(count: ChangesCount) => void>();
  const api = {
    getChangesSummary: vi.fn(async (source: ChangesSource) => summaries(source)),
    getChangesFileDiff: vi.fn(async (
      _source: ChangesSource,
      _placeId: string | null,
      path: string
    ): Promise<ChangesFileDiff> => ({
      path,
      patch: '@@ -1 +1 @@\n-old\n+new',
      binary: false,
      truncated: false
    })),
    markChangesReviewed: vi.fn(async (
      _ownerId: string,
      _files: readonly { placeId: string | null; path: string }[]
    ) => summaryFor(sessionSource)),
    getChangedFilePath: vi.fn(async (
      _source: ChangesSource,
      _placeId: string | null,
      path: string
    ) => `D:\\work\\${path}`),
    openChangedFile: vi.fn(async (
      _source: ChangesSource,
      _placeId: string | null,
      _path: string,
      _action: ChangesOpenAction
    ): Promise<ChangesOpenOutcome> => ({ outcome: 'opened' })),
    writeClipboardText: vi.fn(async (_text: string) => undefined),
    getChangesPlaces: vi.fn(async (_workspaceId: string) => workspacePlaces),
    addChangesPlace: vi.fn(async (_workspaceId: string, _path?: string | null) => workspacePlaces),
    removeChangesPlace: vi.fn(async (_workspaceId: string, _placeId: string) => workspacePlaces),
    suggestChangesPlace: vi.fn(
      async (_workspaceId: string): Promise<{ path: string; name: string } | null> => null
    ),
    getChangesHistory: vi.fn(async (_workspaceId: string): Promise<ChangesHistory> => ({ segments: [] })),
    onChangesCount: vi.fn((listener: (count: ChangesCount) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    })
  };
  const emit = (ownerId: string) => {
    for (const listener of listeners) {
      listener({ ownerId, workspaceId: 'ws-1', state: 'ready', changedFileCount: 2 });
    }
  };
  return { api: api as unknown as ChangesApi & typeof api, emit };
}

export async function findFileList(): Promise<HTMLElement> {
  return screen.findByRole('list', { name: 'Changed files' });
}

export function rowFor(path: string): HTMLElement {
  const row = screen.getByText(path).closest('li');
  if (row === null) throw new Error(`no row for ${path}`);
  return row;
}

export function selectButton(path: string): HTMLElement {
  const button = rowFor(path).querySelector<HTMLElement>('button.changes-file-select');
  if (button === null) throw new Error(`no select button for ${path}`);
  return button;
}

export function openFileMenu(path: string): HTMLElement {
  fireEvent.click(within(rowFor(path)).getByRole('button', { name: 'File actions' }));
  return screen.getByRole('menu', { name: 'File actions' });
}

export function createLocalStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    }
  };
}
