import { describe, expect, it } from 'vitest';

import {
  buildAppearanceOpacityTiers,
  formatAppearanceOpacity
} from './opacity-tiers';

describe('appearance opacity tiers', () => {
  it('keeps popups readable when normal surfaces are fully transparent', () => {
    expect(buildAppearanceOpacityTiers(0)).toEqual({
      recessed: 0,
      normal: 0,
      raised: 0,
      popup: 0.65,
      popupRaised: 0.729625
    });
  });

  it('preserves the fully opaque endpoint', () => {
    expect(buildAppearanceOpacityTiers(1)).toEqual({
      recessed: 1,
      normal: 1,
      raised: 1,
      popup: 1,
      popupRaised: 1
    });
  });

  it('creates a stable hierarchy at intermediate opacity', () => {
    const tiers = buildAppearanceOpacityTiers(0.5);
    expect(tiers.recessed).toBeCloseTo(0.45);
    expect(tiers.normal).toBeCloseTo(0.5);
    expect(tiers.raised).toBeCloseTo(0.5875);
    expect(tiers.popup).toBeCloseTo(0.825);
    expect(tiers.popupRaised).toBeCloseTo(0.87553125);
  });

  it('clamps invalid numeric input and formats CSS percentages', () => {
    expect(buildAppearanceOpacityTiers(-1).normal).toBe(0);
    expect(buildAppearanceOpacityTiers(2).normal).toBe(1);
    expect(formatAppearanceOpacity(0.75178125)).toBe('75.178%');
  });
});
