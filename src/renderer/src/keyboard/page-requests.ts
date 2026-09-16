import { createSurfaceRequest } from './layered-requests';

/**
 * Refresh what is in front: the changes panel when one is open, otherwise the
 * page under it. Each surface says what refreshing means for it, and a surface
 * already refreshing does not answer, so the key cannot queue more work.
 */
const refresh = createSurfaceRequest();
export const requestRefresh = refresh.request;
export const useRefreshRequest = refresh.useRequest;

/**
 * Put the cursor in the search field. Only the pages that search answer, which
 * is what leaves the key to the agent everywhere else.
 */
const focusSearch = createSurfaceRequest();
export const requestFocusSearch = focusSearch.request;
export const useFocusSearchRequest = focusSearch.useRequest;
