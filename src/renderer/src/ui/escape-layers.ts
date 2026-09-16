import { useEffect, useRef } from 'react';

/**
 * Escape belongs to the layer on top.
 *
 * Dialogs and menus each used to listen for Escape on their own, so the one
 * that mounted last won by accident: a menu opened inside a dialog closed the
 * dialog under it. Layers register here instead, the topmost one answers, and
 * nothing below it hears the key.
 */
type EscapeHandler = (() => void) | null;

interface EscapeLayer {
  handler: EscapeHandler;
}

const layers: EscapeLayer[] = [];

function handleKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  const top = layers.at(-1);
  if (top === undefined) return;
  event.preventDefault();
  event.stopPropagation();
  // A layer with no handler is busy: it keeps the key without acting on it.
  top.handler?.();
}

function addLayer(layer: EscapeLayer): () => void {
  if (layers.length === 0) window.addEventListener('keydown', handleKeyDown, true);
  layers.push(layer);
  return () => {
    const index = layers.indexOf(layer);
    if (index >= 0) layers.splice(index, 1);
    if (layers.length === 0) window.removeEventListener('keydown', handleKeyDown, true);
  };
}

/**
 * Closes this layer on Escape while it is the topmost one.
 *
 * Pass null while the layer must not close, such as a dialog doing work it
 * cannot abandon; it still keeps Escape from reaching the layer below. Pass
 * undefined where the layer is not there at all, which is how a component that
 * renders its dialog conditionally says so without moving the hook.
 */
export function useEscapeLayer(onEscape: EscapeHandler | undefined): void {
  const layer = useRef<EscapeLayer>({ handler: onEscape ?? null });
  const present = onEscape !== undefined;
  useEffect(() => {
    layer.current.handler = onEscape ?? null;
  });
  useEffect(() => (present ? addLayer(layer.current) : undefined), [present]);
}

/** The number of open layers; for tests that need to see them unwind. */
export function openEscapeLayerCount(): number {
  return layers.length;
}
