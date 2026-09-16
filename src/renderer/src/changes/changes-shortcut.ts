import { createSurfaceRequest } from '../keyboard/layered-requests';

/**
 * The keyboard shortcuts ask for the changes panel without knowing which one:
 * the session or workspace page in front answers, since each keeps its own.
 */
const toggle = createSurfaceRequest();
export const requestToggleChanges = toggle.request;
export const useToggleChangesRequest = toggle.useRequest;

/** Only an open panel answers this, so the key does nothing when none is shown. */
const maximize = createSurfaceRequest();
export const requestMaximizeChanges = maximize.request;
export const useMaximizeChangesRequest = maximize.useRequest;
