import { useEffect, useState, type RefObject } from 'react';

/** Once no more than this share of the page title shows, the top bar names the page. */
export const PAGE_TITLE_VISIBLE_RATIO = 0.25;

/**
 * Whether the page title has scrolled out of the page, so the top bar can name
 * the page in its place. The title is watched against the page that scrolls it,
 * which reports only when the title crosses the line, not on every scroll.
 */
export function usePageTitleAway(
  titleRef: RefObject<HTMLElement | null>,
  titleShown: boolean
): boolean {
  const [away, setAway] = useState(false);

  useEffect(() => {
    const title = titleRef.current;
    const page = title?.parentElement ?? null;
    if (!titleShown || title === null || page === null || typeof IntersectionObserver === 'undefined') {
      setAway(false);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry !== undefined) setAway(entry.intersectionRatio < PAGE_TITLE_VISIBLE_RATIO);
      },
      { root: page, threshold: [PAGE_TITLE_VISIBLE_RATIO] }
    );
    observer.observe(title);
    return () => observer.disconnect();
  }, [titleRef, titleShown]);

  return away;
}
