import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Keeps a pinned page toolbar pinned over new content. When the toolbar is
 * pinned, the page moves to where the toolbar first pins, so the new content,
 * such as another settings category, starts right beneath it rather than the
 * page returning to its title. A toolbar still resting in the page leaves the
 * page where it is.
 */
export function keepPageToolbarPinned(page: HTMLElement): void {
  const toolbar = page.querySelector<HTMLElement>('.page-toolbar');
  if (toolbar === null) return;
  const pinnedTop = toolbar.getBoundingClientRect().top;
  // Where the toolbar would be if it scrolled with the page.
  const position = toolbar.style.position;
  toolbar.style.position = 'static';
  const restingTop = toolbar.getBoundingClientRect().top;
  toolbar.style.position = position;
  if (pinnedTop - restingTop < 1) return;
  page.scrollTop += restingTop - pinnedTop;
}

/**
 * Brings the page back to the start of what its toolbar filters each time
 * `key` changes, such as a new search, so the first results show right under a
 * pinned toolbar instead of scrolled away above it.
 */
export function useKeepPageToolbarPinned(
  anchorRef: RefObject<HTMLElement | null>,
  key: string
): void {
  const shownKey = useRef(key);
  useLayoutEffect(() => {
    if (shownKey.current === key) return;
    shownKey.current = key;
    const page = anchorRef.current?.closest<HTMLElement>('.main-content');
    if (page !== null && page !== undefined) keepPageToolbarPinned(page);
  }, [anchorRef, key]);
}
