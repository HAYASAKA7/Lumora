import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react';

import {
  STARTUP_PRESENTATION_FADE_MS,
  STARTUP_PRESENTATION_TIMEOUT_MS
} from '../../../shared/startup-presentation';

interface StartupOverlayProps {
  shouldPlay: boolean | null;
  ready: boolean;
  videoSrc: string;
  posterSrc: string;
  onDismissed(): void;
  timeoutMs?: number;
  fadeDurationMs?: number;
}

export function StartupOverlay({
  shouldPlay,
  ready,
  videoSrc,
  posterSrc,
  onDismissed,
  timeoutMs = STARTUP_PRESENTATION_TIMEOUT_MS,
  fadeDurationMs = STARTUP_PRESENTATION_FADE_MS
}: StartupOverlayProps): ReactNode {
  const [mediaFinished, setMediaFinished] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const releaseStarted = useRef(false);
  const fadeTimer = useRef<number | null>(null);

  const beginRelease = useCallback(() => {
    if (releaseStarted.current) {
      return;
    }
    releaseStarted.current = true;
    setLeaving(true);
    fadeTimer.current = window.setTimeout(onDismissed, fadeDurationMs);
  }, [fadeDurationMs, onDismissed]);

  useEffect(() => {
    if (shouldPlay === true && mediaFinished && ready) {
      beginRelease();
    }
  }, [beginRelease, mediaFinished, ready, shouldPlay]);

  useEffect(() => {
    if (shouldPlay !== true) {
      return;
    }
    const timeout = window.setTimeout(beginRelease, timeoutMs);
    return () => window.clearTimeout(timeout);
  }, [beginRelease, shouldPlay, timeoutMs]);

  useEffect(
    () => () => {
      if (fadeTimer.current !== null) {
        window.clearTimeout(fadeTimer.current);
      }
    },
    []
  );

  if (shouldPlay === false) {
    return null;
  }

  const state = leaving
    ? 'leaving'
    : shouldPlay === null
      ? 'waiting-for-window'
      : mediaFinished
        ? 'holding-final-frame'
        : 'playing';

  return (
    <div
      aria-label="Lumora is starting"
      className={`startup-overlay${leaving ? ' startup-overlay-leaving' : ''}`}
      data-state={state}
      role="status"
      style={
        {
          '--startup-fade-duration': `${fadeDurationMs}ms`
        } as CSSProperties
      }
    >
      {shouldPlay === true ? (
        <div className="startup-media-stage">
          {mediaFinished ? (
            <img
              alt="Lumora startup final frame"
              className="startup-media"
              src={posterSrc}
            />
          ) : (
            <video
              autoPlay
              className="startup-media"
              muted
              onEnded={() => setMediaFinished(true)}
              onError={() => setMediaFinished(true)}
              playsInline
              poster={posterSrc}
              src={videoSrc}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
