import { readFile, rename, writeFile } from 'node:fs/promises';

import { z } from 'zod';

export const MIN_WINDOW_WIDTH = 760;
export const MIN_WINDOW_HEIGHT = 560;

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PersistedWindowState {
  version: 1;
  normalBounds: WindowBounds;
  maximized: boolean;
}

export interface WindowRestoreDecision {
  normalBounds: WindowBounds | null;
  maximized: boolean;
  source: 'saved' | 'fallback';
}

interface WindowStateReader {
  readFile(path: string, encoding: 'utf8'): Promise<string>;
}

interface WindowStateFileSystem extends WindowStateReader {
  writeFile(path: string, data: string, encoding: 'utf8'): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
}

type TrackedWindowEvent = 'move' | 'resize' | 'maximize' | 'unmaximize';

interface TrackedWindow {
  on(event: TrackedWindowEvent, listener: () => void): unknown;
  off(event: TrackedWindowEvent, listener: () => void): unknown;
  getBounds(): WindowBounds;
  isMaximized(): boolean;
  isMinimized(): boolean;
  isFullScreen(): boolean;
}

const integer = z.number().finite().int();
const WindowBoundsSchema = z.strictObject({
  x: integer,
  y: integer,
  width: integer.min(MIN_WINDOW_WIDTH),
  height: integer.min(MIN_WINDOW_HEIGHT)
});
const PersistedWindowStateSchema = z.strictObject({
  version: z.literal(1),
  normalBounds: WindowBoundsSchema,
  maximized: z.boolean()
});

export function parseWindowState(
  serialized: string
): PersistedWindowState | null {
  try {
    const parsed = PersistedWindowStateSchema.safeParse(JSON.parse(serialized));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function intersection(
  bounds: WindowBounds,
  workArea: WindowBounds
): { width: number; height: number; area: number } {
  const width = Math.max(
    0,
    Math.min(bounds.x + bounds.width, workArea.x + workArea.width) -
      Math.max(bounds.x, workArea.x)
  );
  const height = Math.max(
    0,
    Math.min(bounds.y + bounds.height, workArea.y + workArea.height) -
      Math.max(bounds.y, workArea.y)
  );
  return { width, height, area: width * height };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function resolveWindowRestore(
  state: PersistedWindowState | null,
  workAreas: readonly WindowBounds[]
): WindowRestoreDecision {
  if (state === null) {
    return { normalBounds: null, maximized: true, source: 'fallback' };
  }

  const candidates = workAreas
    .filter(
      (workArea) =>
        workArea.width >= MIN_WINDOW_WIDTH &&
        workArea.height >= MIN_WINDOW_HEIGHT
    )
    .map((workArea) => ({
      workArea,
      intersection: intersection(state.normalBounds, workArea)
    }))
    .filter(
      ({ intersection: visible }) =>
        visible.width >= 64 && visible.height >= 32
    )
    .sort(
      (left, right) =>
        right.intersection.area - left.intersection.area ||
        left.workArea.x - right.workArea.x ||
        left.workArea.y - right.workArea.y ||
        left.workArea.width - right.workArea.width ||
        left.workArea.height - right.workArea.height
    );
  const selected = candidates[0]?.workArea;

  if (selected === undefined) {
    return { normalBounds: null, maximized: true, source: 'fallback' };
  }

  const width = Math.min(state.normalBounds.width, selected.width);
  const height = Math.min(state.normalBounds.height, selected.height);
  const normalBounds = {
    x: clamp(
      state.normalBounds.x,
      selected.x,
      selected.x + selected.width - width
    ),
    y: clamp(
      state.normalBounds.y,
      selected.y,
      selected.y + selected.height - height
    ),
    width,
    height
  };

  return {
    normalBounds,
    maximized: state.maximized,
    source: 'saved'
  };
}

export function applyStartupMaximization(
  restore: WindowRestoreDecision,
  startMaximized: boolean
): WindowRestoreDecision {
  return {
    ...restore,
    maximized: startMaximized
  };
}

export async function loadWindowRestore({
  statePath,
  workAreas,
  fileSystem = { readFile },
  reportError = (message, error) => console.error(message, error)
}: {
  statePath: string;
  workAreas: readonly WindowBounds[];
  fileSystem?: WindowStateReader;
  reportError?: (message: string, error: unknown) => void;
}): Promise<WindowRestoreDecision> {
  try {
    const serialized = await fileSystem.readFile(statePath, 'utf8');
    return resolveWindowRestore(parseWindowState(serialized), workAreas);
  } catch (error) {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    ) {
      reportError(`Unable to read Lumora window state at ${statePath}.`, error);
    }
    return resolveWindowRestore(null, workAreas);
  }
}

export interface WindowStateManager {
  flush(): Promise<void>;
  dispose(): Promise<void>;
}

export function createWindowStateManager({
  window,
  statePath,
  initialNormalBounds,
  fileSystem = { readFile, writeFile, rename },
  reportError = (message, error) => console.error(message, error),
  debounceMs = 250
}: {
  window: TrackedWindow;
  statePath: string;
  initialNormalBounds: WindowBounds;
  fileSystem?: WindowStateFileSystem;
  reportError?: (message: string, error: unknown) => void;
  debounceMs?: number;
}): WindowStateManager {
  let latestState: PersistedWindowState = {
    version: 1,
    normalBounds: { ...initialNormalBounds },
    maximized: window.isMaximized()
  };
  let dirty = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let writeQueue = Promise.resolve();
  let disposal: Promise<void> | null = null;

  const queueWrite = (): Promise<void> => {
    if (!dirty) {
      return writeQueue;
    }

    dirty = false;
    const snapshot = JSON.stringify(latestState);
    const temporaryPath = `${statePath}.tmp`;
    writeQueue = writeQueue
      .then(async () => {
        await fileSystem.writeFile(temporaryPath, snapshot, 'utf8');
        await fileSystem.rename(temporaryPath, statePath);
      })
      .catch((error: unknown) => {
        reportError(
          `Unable to persist Lumora window state at ${statePath}.`,
          error
        );
      });
    return writeQueue;
  };

  const scheduleWrite = (): void => {
    dirty = true;
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void queueWrite();
    }, debounceMs);
  };

  const captureGeometry = (): void => {
    const maximized = window.isMaximized();
    if (!maximized && !window.isMinimized() && !window.isFullScreen()) {
      latestState = {
        ...latestState,
        normalBounds: { ...window.getBounds() }
      };
    }
    latestState = { ...latestState, maximized };
    scheduleWrite();
  };

  const captureMaximized = (): void => {
    latestState = { ...latestState, maximized: window.isMaximized() };
    scheduleWrite();
  };

  const geometryEvents = ['move', 'resize'] as const;
  const maximizationEvents = ['maximize', 'unmaximize'] as const;
  for (const event of geometryEvents) {
    window.on(event, captureGeometry);
  }
  for (const event of maximizationEvents) {
    window.on(event, captureMaximized);
  }

  const flush = (): Promise<void> => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    return queueWrite();
  };

  const dispose = (): Promise<void> => {
    if (disposal !== null) {
      return disposal;
    }
    for (const event of geometryEvents) {
      window.off(event, captureGeometry);
    }
    for (const event of maximizationEvents) {
      window.off(event, captureMaximized);
    }
    disposal = flush();
    return disposal;
  };

  return { flush, dispose };
}
