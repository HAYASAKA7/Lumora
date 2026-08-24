import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StartupOverlay } from './StartupOverlay';
import { renderWithLocalization } from '../test/render-with-localization';

const videoSrc = '/assets/lumora-startup.mp4';
const posterSrc = '/assets/lumora-startup-final.png';

afterEach(() => {
  vi.useRealTimers();
});

describe('StartupOverlay', () => {
  it('covers the renderer without starting media while the window claim is pending', () => {
    renderWithLocalization(
      <StartupOverlay
        onDismissed={vi.fn()}
        posterSrc={posterSrc}
        ready={false}
        shouldPlay={null}
        videoSrc={videoSrc}
      />
    );

    expect(screen.getByRole('status', { name: 'Lumora is starting' })).toHaveAttribute(
      'data-state',
      'waiting-for-window'
    );
    expect(document.querySelector('video')).toBeNull();
  });

  it('plays silent inline media after the visible window grants the claim', () => {
    renderWithLocalization(
      <StartupOverlay
        onDismissed={vi.fn()}
        posterSrc={posterSrc}
        ready={false}
        shouldPlay
        videoSrc={videoSrc}
      />
    );

    const video = document.querySelector('video');
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute('src', videoSrc);
    expect(video).toHaveAttribute('autoplay');
    expect(video).toHaveAttribute('playsinline');
    expect(video).toHaveProperty('muted', true);
    expect(video?.parentElement).toHaveClass('startup-media-stage');
  });

  it('holds the final frame until startup work settles, then fades away', () => {
    vi.useFakeTimers();
    const onDismissed = vi.fn();
    const { rerender } = renderWithLocalization(
      <StartupOverlay
        fadeDurationMs={200}
        onDismissed={onDismissed}
        posterSrc={posterSrc}
        ready={false}
        shouldPlay
        videoSrc={videoSrc}
      />
    );

    fireEvent.ended(document.querySelector('video')!);

    expect(screen.getByRole('img', { name: 'Lumora startup final frame' })).toHaveAttribute(
      'src',
      posterSrc
    );
    expect(onDismissed).not.toHaveBeenCalled();

    rerender(
      <StartupOverlay
        fadeDurationMs={200}
        onDismissed={onDismissed}
        posterSrc={posterSrc}
        ready
        shouldPlay
        videoSrc={videoSrc}
      />
    );

    expect(screen.getByRole('status', { name: 'Lumora is starting' })).toHaveAttribute(
      'data-state',
      'leaving'
    );
    act(() => vi.advanceTimersByTime(200));
    expect(onDismissed).toHaveBeenCalledTimes(1);
  });

  it('uses a synchronized 500ms crossfade by default', () => {
    vi.useFakeTimers();
    const onDismissed = vi.fn();
    renderWithLocalization(
      <StartupOverlay
        onDismissed={onDismissed}
        posterSrc={posterSrc}
        ready
        shouldPlay
        videoSrc={videoSrc}
      />
    );

    const overlay = screen.getByRole('status', { name: 'Lumora is starting' });
    expect(overlay).toHaveStyle('--startup-fade-duration: 500ms');

    fireEvent.ended(document.querySelector('video')!);
    expect(overlay).toHaveAttribute('data-state', 'leaving');

    act(() => vi.advanceTimersByTime(499));
    expect(onDismissed).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismissed).toHaveBeenCalledTimes(1);
  });

  it('uses the final frame if video playback fails', () => {
    renderWithLocalization(
      <StartupOverlay
        onDismissed={vi.fn()}
        posterSrc={posterSrc}
        ready={false}
        shouldPlay
        videoSrc={videoSrc}
      />
    );

    fireEvent.error(document.querySelector('video')!);

    expect(screen.getByRole('img', { name: 'Lumora startup final frame' })).toBeVisible();
  });

  it('renders nothing when this process has already presented startup', () => {
    renderWithLocalization(
      <StartupOverlay
        onDismissed={vi.fn()}
        posterSrc={posterSrc}
        ready={false}
        shouldPlay={false}
        videoSrc={videoSrc}
      />
    );

    expect(screen.queryByRole('status', { name: 'Lumora is starting' })).toBeNull();
  });

  it('releases a stalled startup after the safety timeout and fade', () => {
    vi.useFakeTimers();
    const onDismissed = vi.fn();
    renderWithLocalization(
      <StartupOverlay
        fadeDurationMs={200}
        onDismissed={onDismissed}
        posterSrc={posterSrc}
        ready={false}
        shouldPlay
        timeoutMs={15_000}
        videoSrc={videoSrc}
      />
    );

    act(() => vi.advanceTimersByTime(15_000));
    expect(screen.getByRole('status', { name: 'Lumora is starting' })).toHaveAttribute(
      'data-state',
      'leaving'
    );
    act(() => vi.advanceTimersByTime(200));
    expect(onDismissed).toHaveBeenCalledTimes(1);
  });
});
