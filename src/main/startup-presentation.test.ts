import { describe, expect, it, vi } from 'vitest';

import * as startupPresentation from './startup-presentation';

const {
  createStartupBackgroundActivityController,
  createStartupPresentationController
} = startupPresentation;

describe('createStartupPresentationController', () => {
  it('exposes whether the first window still needs startup preparation', async () => {
    const controller = createStartupPresentationController();

    expect(controller.isClaimAvailable()).toBe(true);

    const claim = controller.claim();
    expect(controller.isClaimAvailable()).toBe(false);

    controller.markWindowShown();
    await expect(claim).resolves.toBe(true);
    expect(controller.isClaimAvailable()).toBe(false);
  });

  it('holds the first presentation claim until the first window is shown', async () => {
    const controller = createStartupPresentationController();
    const resolved = vi.fn();

    const claim = controller.claim();
    void claim.then(resolved);
    await Promise.resolve();

    expect(resolved).not.toHaveBeenCalled();

    controller.markWindowShown();

    await expect(claim).resolves.toBe(true);
    expect(resolved).toHaveBeenCalledWith(true);
  });

  it('grants only one presentation claim during the process lifetime', async () => {
    const controller = createStartupPresentationController();

    controller.markWindowShown();
    controller.markWindowShown();

    await expect(controller.claim()).resolves.toBe(true);
    await expect(controller.claim()).resolves.toBe(false);
  });

  it('rejects later claims while the first claim is waiting for the window', async () => {
    const controller = createStartupPresentationController();
    const firstClaim = controller.claim();

    await expect(controller.claim()).resolves.toBe(false);

    controller.markWindowShown();
    await expect(firstClaim).resolves.toBe(true);
  });
});

describe('startup background activity', () => {
  it('disables throttling only when startup playback begins', () => {
    vi.useFakeTimers();
    const setBackgroundThrottling = vi.fn();
    const controller = createStartupBackgroundActivityController({
      isDestroyed: () => false,
      setBackgroundThrottling
    });

    expect(setBackgroundThrottling).not.toHaveBeenCalled();

    controller.start();
    expect(setBackgroundThrottling).toHaveBeenCalledTimes(1);
    expect(setBackgroundThrottling).toHaveBeenLastCalledWith(false);

    vi.advanceTimersByTime(59_999);
    expect(setBackgroundThrottling).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(setBackgroundThrottling).toHaveBeenCalledTimes(2);
    expect(setBackgroundThrottling).toHaveBeenLastCalledWith(true);

    controller.dispose();
    expect(setBackgroundThrottling).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('restores throttling once when startup playback completes', () => {
    vi.useFakeTimers();
    const setBackgroundThrottling = vi.fn();
    const controller = createStartupBackgroundActivityController({
      isDestroyed: () => false,
      setBackgroundThrottling
    });

    controller.start();
    controller.complete();
    controller.complete();
    controller.dispose();
    vi.advanceTimersByTime(60_000);

    expect(setBackgroundThrottling.mock.calls).toEqual([[false], [true]]);
    vi.useRealTimers();
  });

  it('does not touch a destroyed web contents while disposing', () => {
    vi.useFakeTimers();
    let destroyed = false;
    const setBackgroundThrottling = vi.fn();
    const controller = createStartupBackgroundActivityController({
      isDestroyed: () => destroyed,
      setBackgroundThrottling
    });

    controller.start();
    destroyed = true;
    controller.dispose();
    vi.advanceTimersByTime(60_000);

    expect(setBackgroundThrottling.mock.calls).toEqual([[false]]);
    vi.useRealTimers();
  });

  it('does nothing when an unclaimed startup window is disposed', () => {
    const setBackgroundThrottling = vi.fn();
    const controller = createStartupBackgroundActivityController({
      isDestroyed: () => false,
      setBackgroundThrottling
    });

    controller.dispose();

    expect(setBackgroundThrottling).not.toHaveBeenCalled();
  });
});
