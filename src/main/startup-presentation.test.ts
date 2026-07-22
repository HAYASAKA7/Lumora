import { describe, expect, it, vi } from 'vitest';

import { createStartupPresentationController } from './startup-presentation';

describe('createStartupPresentationController', () => {
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
