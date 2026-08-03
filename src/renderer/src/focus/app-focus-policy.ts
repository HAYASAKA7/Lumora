const EDITABLE_OR_SPECIALIZED_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable="false"])',
  '.managed-terminal',
  '.shortcut-recorder[aria-pressed="true"]'
].join(', ');

const MODIFIER_KEYS = new Set([
  'Alt',
  'AltGraph',
  'Control',
  'Meta',
  'Shift'
]);

export function isLumoraEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(EDITABLE_OR_SPECIALIZED_SELECTOR) !== null
  );
}

export function releaseLumoraCommandFocus(root: Document = document): void {
  const active = root.activeElement;
  if (
    active instanceof HTMLElement &&
    active.matches('[data-lumora-command]')
  ) {
    active.blur();
  }
}

function isOrdinaryTyping(event: KeyboardEvent): boolean {
  return (
    !event.isComposing &&
    event.key.length === 1 &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey
  );
}

function isAppShortcut(event: KeyboardEvent): boolean {
  return (
    !event.isComposing &&
    !MODIFIER_KEYS.has(event.key) &&
    (event.ctrlKey || event.altKey || event.metaKey)
  );
}

export function installAppFocusPolicy(root: Document = document): () => void {
  const keydown = (event: KeyboardEvent) => {
    if (isLumoraEditableTarget(event.target)) return;
    if (isOrdinaryTyping(event) || isAppShortcut(event)) {
      releaseLumoraCommandFocus(root);
    }
  };
  const pointerup = (event: PointerEvent) => {
    if (
      event.target instanceof Element &&
      event.target.closest('[data-lumora-command]') !== null
    ) {
      releaseLumoraCommandFocus(root);
    }
  };

  root.addEventListener('keydown', keydown, true);
  root.addEventListener('pointerup', pointerup, true);
  return () => {
    root.removeEventListener('keydown', keydown, true);
    root.removeEventListener('pointerup', pointerup, true);
  };
}
