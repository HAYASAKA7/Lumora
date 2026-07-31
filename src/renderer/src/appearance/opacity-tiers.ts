export interface AppearanceOpacityTiers {
  recessed: number;
  normal: number;
  raised: number;
  popup: number;
  popupRaised: number;
}

function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function buildAppearanceOpacityTiers(
  surfaceOpacity: number
): AppearanceOpacityTiers {
  const normal = clampOpacity(surfaceOpacity);
  const transition = normal * (1 - normal);
  const recessed = normal - 0.2 * transition;
  const raised = normal + 0.35 * transition;
  const popup = 0.65 + 0.35 * normal;
  const popupRaised = popup + 0.35 * popup * (1 - popup);

  return { recessed, normal, raised, popup, popupRaised };
}

export function formatAppearanceOpacity(value: number): string {
  return `${Number((clampOpacity(value) * 100).toFixed(3))}%`;
}
