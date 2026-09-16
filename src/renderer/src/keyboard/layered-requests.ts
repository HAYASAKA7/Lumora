import { useEffect, useRef } from 'react';

/**
 * A shortcut asks for something without knowing who will do it.
 *
 * Surfaces answer while they are open, and the innermost one wins: a changes
 * panel refreshes itself rather than the page it sits on, because it opened
 * last. A request nobody answers is not swallowed, so the key reaches the
 * terminal or the composer as it would have without the shortcut.
 */
interface RequestLayer {
  answer: (() => void) | null;
}

export interface SurfaceRequest {
  /** Runs the innermost answer, and reports whether anyone was listening. */
  request(): boolean;
  /** Answers this request while `active`, above anything that registered earlier. */
  useRequest(active: boolean, answer: () => void): void;
}

export function createSurfaceRequest(): SurfaceRequest {
  const layers: RequestLayer[] = [];

  return {
    request(): boolean {
      for (let index = layers.length - 1; index >= 0; index -= 1) {
        const answer = layers[index]?.answer;
        if (answer === null || answer === undefined) continue;
        answer();
        return true;
      }
      return false;
    },
    useRequest(active: boolean, answer: () => void): void {
      const layer = useRef<RequestLayer>({ answer });
      useEffect(() => {
        layer.current.answer = answer;
      });
      useEffect(() => {
        if (!active) return undefined;
        const registered = layer.current;
        layers.push(registered);
        return () => {
          const index = layers.indexOf(registered);
          if (index >= 0) layers.splice(index, 1);
        };
      }, [active]);
    }
  };
}
