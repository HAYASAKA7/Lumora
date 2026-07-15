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
    .sort((left, right) => right.intersection.area - left.intersection.area);
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
