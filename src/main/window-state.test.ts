import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  applyStartupMaximization,
  createSharedWindowStateManager,
  createWindowStateManager,
  loadWindowRestore,
  parseWindowState,
  resolveWindowRestore,
  type PersistedWindowState,
  type WindowBounds
} from './window-state';

const primaryWorkArea: WindowBounds = {
  x: 0,
  y: 0,
  width: 1920,
  height: 1040
};

const validState: PersistedWindowState = {
  version: 1,
  normalBounds: {
    x: 100,
    y: 80,
    width: 1280,
    height: 800
  },
  maximized: false
};

describe('parseWindowState', () => {
  it('accepts only the strict versioned window-state shape', () => {
    expect(parseWindowState(JSON.stringify(validState))).toEqual(validState);
    expect(
      parseWindowState(JSON.stringify({ ...validState, version: 2 }))
    ).toBeNull();
    expect(
      parseWindowState(JSON.stringify({ ...validState, extra: true }))
    ).toBeNull();
    expect(parseWindowState('{broken')).toBeNull();
  });

  it('rejects non-integer, non-finite, and undersized bounds', () => {
    const invalidBounds = [
      { ...validState.normalBounds, x: 1.5 },
      { ...validState.normalBounds, y: Number.POSITIVE_INFINITY },
      { ...validState.normalBounds, width: MIN_WINDOW_WIDTH - 1 },
      { ...validState.normalBounds, height: MIN_WINDOW_HEIGHT - 1 }
    ];

    for (const normalBounds of invalidBounds) {
      expect(
        parseWindowState(JSON.stringify({ ...validState, normalBounds }))
      ).toBeNull();
    }
  });
});

describe('resolveWindowRestore', () => {
  it('maximizes first launches and invalid-state fallbacks', () => {
    expect(resolveWindowRestore(null, [primaryWorkArea])).toEqual({
      normalBounds: null,
      maximized: true,
      source: 'fallback'
    });
    expect(resolveWindowRestore(validState, [])).toEqual({
      normalBounds: null,
      maximized: true,
      source: 'fallback'
    });
  });

  it('restores visible bounds and their maximized state', () => {
    expect(
      resolveWindowRestore(
        { ...validState, maximized: true },
        [primaryWorkArea]
      )
    ).toEqual({
      normalBounds: validState.normalBounds,
      maximized: true,
      source: 'saved'
    });
  });

  it('clamps partially visible bounds fully inside the display work area', () => {
    const state = {
      ...validState,
      normalBounds: {
        x: -200,
        y: -100,
        width: 2200,
        height: 1200
      }
    };

    expect(resolveWindowRestore(state, [primaryWorkArea])).toEqual({
      normalBounds: primaryWorkArea,
      maximized: false,
      source: 'saved'
    });
  });

  it('uses the qualifying display with the largest intersection', () => {
    const leftDisplay = { x: -1280, y: 0, width: 1280, height: 1024 };
    const rightDisplay = { x: 0, y: 0, width: 1920, height: 1040 };
    const state = {
      ...validState,
      normalBounds: {
        x: -400,
        y: 100,
        width: 1400,
        height: 800
      }
    };

    expect(resolveWindowRestore(state, [leftDisplay, rightDisplay])).toEqual({
      normalBounds: {
        x: 0,
        y: 100,
        width: 1400,
        height: 800
      },
      maximized: false,
      source: 'saved'
    });
  });

  it('breaks equal display intersections independently of enumeration order', () => {
    const leftDisplay = { x: -1280, y: 0, width: 1280, height: 1024 };
    const rightDisplay = { x: 0, y: 0, width: 1280, height: 1024 };
    const centeredState = {
      ...validState,
      normalBounds: {
        x: -380,
        y: 100,
        width: MIN_WINDOW_WIDTH,
        height: MIN_WINDOW_HEIGHT
      }
    };

    const leftFirst = resolveWindowRestore(centeredState, [
      leftDisplay,
      rightDisplay
    ]);
    const rightFirst = resolveWindowRestore(centeredState, [
      rightDisplay,
      leftDisplay
    ]);

    expect(leftFirst).toEqual(rightFirst);
    expect(leftFirst.normalBounds?.x).toBe(-760);
  });

  it('falls back for off-screen bounds and undersized display work areas', () => {
    const offScreenState = {
      ...validState,
      normalBounds: { ...validState.normalBounds, x: 5000, y: 5000 }
    };
    const undersizedDisplay = {
      x: 0,
      y: 0,
      width: MIN_WINDOW_WIDTH - 1,
      height: MIN_WINDOW_HEIGHT
    };

    expect(resolveWindowRestore(offScreenState, [primaryWorkArea]).source).toBe(
      'fallback'
    );
    expect(resolveWindowRestore(validState, [undersizedDisplay]).source).toBe(
      'fallback'
    );
  });

  it('requires a 64 by 32 pixel visible intersection', () => {
    const only63Wide = {
      ...validState,
      normalBounds: {
        ...validState.normalBounds,
        x: primaryWorkArea.width - 63
      }
    };
    const exactlyVisible = {
      ...validState,
      normalBounds: {
        ...validState.normalBounds,
        x: primaryWorkArea.width - 64,
        y: primaryWorkArea.height - 32
      }
    };

    expect(resolveWindowRestore(only63Wide, [primaryWorkArea]).source).toBe(
      'fallback'
    );
    expect(resolveWindowRestore(exactlyVisible, [primaryWorkArea]).source).toBe(
      'saved'
    );
  });
});

describe('applyStartupMaximization', () => {
  it('maximizes when the startup preference is enabled', () => {
    expect(
      applyStartupMaximization(
        {
          normalBounds: validState.normalBounds,
          maximized: false,
          source: 'saved'
        },
        true
      )
    ).toEqual({
      normalBounds: validState.normalBounds,
      maximized: true,
      source: 'saved'
    });
  });

  it('restores normal bounds when the startup preference is disabled', () => {
    expect(
      applyStartupMaximization(
        {
          normalBounds: validState.normalBounds,
          maximized: true,
          source: 'saved'
        },
        false
      )
    ).toEqual({
      normalBounds: validState.normalBounds,
      maximized: false,
      source: 'saved'
    });
  });
});

describe('loadWindowRestore', () => {
  it('loads valid persisted state and resolves it against current displays', async () => {
    const fileSystem = {
      readFile: vi.fn().mockResolvedValue(JSON.stringify(validState)),
      writeFile: vi.fn(),
      rename: vi.fn()
    };
    const reportError = vi.fn();

    await expect(
      loadWindowRestore({
        statePath: 'window-state.json',
        workAreas: [primaryWorkArea],
        fileSystem,
        reportError
      })
    ).resolves.toEqual({
      normalBounds: validState.normalBounds,
      maximized: false,
      source: 'saved'
    });
    expect(reportError).not.toHaveBeenCalled();
  });

  it('treats a missing file and malformed JSON as first-launch fallback', async () => {
    const missingError = Object.assign(new Error('missing'), { code: 'ENOENT' });
    const fileSystem = {
      readFile: vi
        .fn()
        .mockRejectedValueOnce(missingError)
        .mockResolvedValueOnce('{broken'),
      writeFile: vi.fn(),
      rename: vi.fn()
    };
    const reportError = vi.fn();
    const options = {
      statePath: 'window-state.json',
      workAreas: [primaryWorkArea],
      fileSystem,
      reportError
    };

    await expect(loadWindowRestore(options)).resolves.toMatchObject({
      maximized: true,
      source: 'fallback'
    });
    await expect(loadWindowRestore(options)).resolves.toMatchObject({
      maximized: true,
      source: 'fallback'
    });
    expect(reportError).not.toHaveBeenCalled();
  });

  it('reports non-missing read errors without preventing startup', async () => {
    const readError = Object.assign(new Error('denied'), { code: 'EACCES' });
    const fileSystem = {
      readFile: vi.fn().mockRejectedValue(readError),
      writeFile: vi.fn(),
      rename: vi.fn()
    };
    const reportError = vi.fn();

    await expect(
      loadWindowRestore({
        statePath: 'C:/Lumora/window-state.json',
        workAreas: [primaryWorkArea],
        fileSystem,
        reportError
      })
    ).resolves.toMatchObject({ maximized: true, source: 'fallback' });
    expect(reportError).toHaveBeenCalledOnce();
    expect(reportError.mock.calls[0]?.[0]).toContain(
      'C:/Lumora/window-state.json'
    );
    expect(reportError.mock.calls[0]?.[1]).toBe(readError);
  });
});

type WindowEvent = 'move' | 'resize' | 'maximize' | 'unmaximize';

function createFakeWindow(initialBounds: WindowBounds = validState.normalBounds) {
  const listeners = new Map<WindowEvent, Set<() => void>>();
  let bounds = { ...initialBounds };
  let maximized = false;
  let minimized = false;
  let fullScreen = false;

  return {
    on(event: WindowEvent, listener: () => void) {
      const eventListeners = listeners.get(event) ?? new Set();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
    },
    off(event: WindowEvent, listener: () => void) {
      listeners.get(event)?.delete(listener);
    },
    getBounds: () => ({ ...bounds }),
    isMaximized: () => maximized,
    isMinimized: () => minimized,
    isFullScreen: () => fullScreen,
    emit(event: WindowEvent) {
      for (const listener of listeners.get(event) ?? []) {
        listener();
      }
    },
    setBounds(nextBounds: WindowBounds) {
      bounds = { ...nextBounds };
    },
    setMaximized(value: boolean) {
      maximized = value;
    },
    setMinimized(value: boolean) {
      minimized = value;
    },
    setFullScreen(value: boolean) {
      fullScreen = value;
    },
    listenerCount(event: WindowEvent) {
      return listeners.get(event)?.size ?? 0;
    }
  };
}

function createWritingFileSystem() {
  return {
    readFile: vi.fn(),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined)
  };
}

function writtenState(fileSystem: ReturnType<typeof createWritingFileSystem>) {
  const serialized = fileSystem.writeFile.mock.calls.at(-1)?.[1];
  return JSON.parse(String(serialized)) as PersistedWindowState;
}

describe('createWindowStateManager', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces rapid normal move and resize events into one atomic write', async () => {
    const window = createFakeWindow();
    const fileSystem = createWritingFileSystem();
    const manager = createWindowStateManager({
      window,
      statePath: 'window-state.json',
      initialNormalBounds: validState.normalBounds,
      fileSystem,
      debounceMs: 250
    });
    const movedBounds = { x: 240, y: 160, width: 1100, height: 700 };

    window.setBounds(movedBounds);
    window.emit('move');
    window.emit('resize');
    await vi.advanceTimersByTimeAsync(249);
    expect(fileSystem.writeFile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(fileSystem.writeFile).toHaveBeenCalledOnce();
    expect(fileSystem.writeFile).toHaveBeenCalledWith(
      'window-state.json.tmp',
      expect.any(String),
      'utf8'
    );
    expect(fileSystem.rename).toHaveBeenCalledWith(
      'window-state.json.tmp',
      'window-state.json'
    );
    expect(writtenState(fileSystem)).toEqual({
      version: 1,
      normalBounds: movedBounds,
      maximized: false
    });
    await manager.dispose();
  });

  it('preserves normal bounds while maximized, minimized, or fullscreen', async () => {
    const window = createFakeWindow();
    const fileSystem = createWritingFileSystem();
    const manager = createWindowStateManager({
      window,
      statePath: 'window-state.json',
      initialNormalBounds: validState.normalBounds,
      fileSystem
    });

    window.setBounds({ x: 0, y: 0, width: 1920, height: 1040 });
    window.setMaximized(true);
    window.emit('maximize');
    window.emit('resize');
    window.setMinimized(true);
    window.emit('move');
    window.setMinimized(false);
    window.setFullScreen(true);
    window.emit('resize');
    await manager.flush();

    expect(writtenState(fileSystem)).toEqual({
      version: 1,
      normalBounds: validState.normalBounds,
      maximized: true
    });

    const transientBounds = { x: 0, y: 0, width: 1920, height: 1040 };
    window.setFullScreen(false);
    window.setMaximized(false);
    window.setBounds(transientBounds);
    window.emit('unmaximize');
    await manager.flush();
    expect(writtenState(fileSystem)).toEqual({
      version: 1,
      normalBounds: validState.normalBounds,
      maximized: false
    });

    const restoredBounds = { x: 50, y: 60, width: 1000, height: 720 };
    window.setBounds(restoredBounds);
    window.emit('resize');
    await manager.flush();
    expect(writtenState(fileSystem)).toEqual({
      version: 1,
      normalBounds: restoredBounds,
      maximized: false
    });
    await manager.dispose();
  });

  it('orders writes so a newer snapshot cannot be overwritten by an older one', async () => {
    let finishFirstWrite: (() => void) | undefined;
    const firstWrite = new Promise<void>((resolve) => {
      finishFirstWrite = resolve;
    });
    const window = createFakeWindow();
    const fileSystem = createWritingFileSystem();
    fileSystem.writeFile
      .mockImplementationOnce(() => firstWrite)
      .mockResolvedValue(undefined);
    const manager = createWindowStateManager({
      window,
      statePath: 'window-state.json',
      initialNormalBounds: validState.normalBounds,
      fileSystem,
      debounceMs: 10
    });

    window.setBounds({ x: 10, y: 10, width: 1000, height: 700 });
    window.emit('move');
    await vi.advanceTimersByTimeAsync(10);
    window.setBounds({ x: 20, y: 20, width: 1100, height: 750 });
    window.emit('move');
    await vi.advanceTimersByTimeAsync(10);
    expect(fileSystem.writeFile).toHaveBeenCalledOnce();

    finishFirstWrite?.();
    await manager.flush();
    expect(fileSystem.writeFile).toHaveBeenCalledTimes(2);
    expect(writtenState(fileSystem).normalBounds).toEqual({
      x: 20,
      y: 20,
      width: 1100,
      height: 750
    });
    await manager.dispose();
  });

  it('flushes immediately, disposes idempotently, and detaches listeners', async () => {
    const window = createFakeWindow();
    const fileSystem = createWritingFileSystem();
    const manager = createWindowStateManager({
      window,
      statePath: 'window-state.json',
      initialNormalBounds: validState.normalBounds,
      fileSystem,
      debounceMs: 250
    });

    window.emit('move');
    const firstDispose = manager.dispose();
    const secondDispose = manager.dispose();
    expect(secondDispose).toBe(firstDispose);
    await firstDispose;
    expect(fileSystem.writeFile).toHaveBeenCalledOnce();
    expect(window.listenerCount('move')).toBe(0);

    window.emit('move');
    await vi.advanceTimersByTimeAsync(250);
    expect(fileSystem.writeFile).toHaveBeenCalledOnce();
  });

  it('reports write failures without rejecting final flush', async () => {
    const writeError = new Error('disk full');
    const window = createFakeWindow();
    const fileSystem = createWritingFileSystem();
    fileSystem.writeFile.mockRejectedValue(writeError);
    const reportError = vi.fn();
    const manager = createWindowStateManager({
      window,
      statePath: 'window-state.json',
      initialNormalBounds: validState.normalBounds,
      fileSystem,
      reportError
    });

    window.emit('move');
    await expect(manager.flush()).resolves.toBeUndefined();
    expect(reportError).toHaveBeenCalledOnce();
    expect(reportError.mock.calls[0]?.[1]).toBe(writeError);
    await expect(manager.dispose()).resolves.toBeUndefined();
  });
});

describe('createSharedWindowStateManager', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('restores shared remote bounds while applying the current startup preference', async () => {
    const fileSystem = createWritingFileSystem();
    fileSystem.readFile.mockResolvedValue(JSON.stringify({
      ...validState,
      maximized: false
    }));
    const manager = await createSharedWindowStateManager({
      statePath: 'remote-window-state.json',
      workAreas: [primaryWorkArea],
      fileSystem
    });

    expect(manager.restore([primaryWorkArea], true)).toEqual({
      normalBounds: validState.normalBounds,
      maximized: true,
      source: 'saved'
    });
    expect(manager.restore([primaryWorkArea], false)).toEqual({
      normalBounds: validState.normalBounds,
      maximized: false,
      source: 'saved'
    });

    await manager.dispose();
  });

  it('persists the latest event across tracked remote windows through one queue', async () => {
    const fileSystem = createWritingFileSystem();
    fileSystem.readFile.mockRejectedValue(
      Object.assign(new Error('missing'), { code: 'ENOENT' })
    );
    const manager = await createSharedWindowStateManager({
      statePath: 'remote-window-state.json',
      workAreas: [primaryWorkArea],
      fileSystem,
      debounceMs: 25
    });
    const firstWindow = createFakeWindow();
    const secondWindow = createFakeWindow({
      x: 220,
      y: 140,
      width: 1000,
      height: 700
    });
    const first = manager.track(firstWindow, firstWindow.getBounds());
    const second = manager.track(secondWindow, secondWindow.getBounds());
    const latestBounds = { x: 300, y: 180, width: 1120, height: 760 };

    firstWindow.setBounds({ x: 40, y: 40, width: 900, height: 650 });
    firstWindow.emit('resize');
    secondWindow.setBounds(latestBounds);
    secondWindow.emit('move');
    secondWindow.setMaximized(true);
    secondWindow.emit('maximize');
    await vi.advanceTimersByTimeAsync(25);

    expect(fileSystem.writeFile).toHaveBeenCalledOnce();
    expect(writtenState(fileSystem)).toEqual({
      version: 1,
      normalBounds: latestBounds,
      maximized: true
    });
    expect(manager.restore([primaryWorkArea], false)).toMatchObject({
      normalBounds: latestBounds,
      maximized: false,
      source: 'saved'
    });

    await first.dispose();
    expect(firstWindow.listenerCount('resize')).toBe(0);
    expect(secondWindow.listenerCount('resize')).toBe(1);
    await second.dispose();
    await manager.dispose();
  });

  it('preserves the latest normal bounds during transient remote window states', async () => {
    const fileSystem = createWritingFileSystem();
    fileSystem.readFile.mockResolvedValue(JSON.stringify(validState));
    const manager = await createSharedWindowStateManager({
      statePath: 'remote-window-state.json',
      workAreas: [primaryWorkArea],
      fileSystem
    });
    const window = createFakeWindow(validState.normalBounds);
    const tracked = manager.track(window, validState.normalBounds);

    window.setMaximized(true);
    window.setBounds(primaryWorkArea);
    window.emit('maximize');
    window.emit('resize');
    window.setMinimized(true);
    window.emit('move');
    window.setMinimized(false);
    window.setFullScreen(true);
    window.emit('resize');
    await manager.flush();

    expect(writtenState(fileSystem)).toEqual({
      version: 1,
      normalBounds: validState.normalBounds,
      maximized: true
    });

    await tracked.dispose();
    await manager.dispose();
  });
});
