import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  description?: string;
  onSelect(): void;
}

interface ContextMenuProps {
  anchor: { x: number; y: number };
  items: readonly ContextMenuItem[];
  label: string;
  onClose(): void;
}

const VIEWPORT_GAP = 8;

export function ContextMenu({
  anchor,
  items,
  label,
  onClose
}: ContextMenuProps): ReactNode {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState(anchor);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (menu === null) return;
    const bounds = menu.getBoundingClientRect();
    setPosition({
      x: Math.max(
        VIEWPORT_GAP,
        Math.min(anchor.x, window.innerWidth - bounds.width - VIEWPORT_GAP)
      ),
      y: Math.max(
        VIEWPORT_GAP,
        Math.min(anchor.y, window.innerHeight - bounds.height - VIEWPORT_GAP)
      )
    });
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [anchor.x, anchor.y]);

  useEffect(() => {
    const dismissFromPointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        menuRef.current?.contains(event.target)
      ) return;
      onClose();
    };
    const dismissFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('pointerdown', dismissFromPointer, true);
    window.addEventListener('keydown', dismissFromKeyboard, true);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', dismissFromPointer, true);
      window.removeEventListener('keydown', dismissFromKeyboard, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      aria-label={label}
      className="select-menu-options select-menu-options-overlay action-menu-options"
      ref={menuRef}
      role="menu"
      style={{
        left: position.x,
        position: 'fixed',
        top: position.y
      }}
    >
      {items.map((item) => (
        <button
          aria-description={item.description}
          className="select-menu-option"
          disabled={item.disabled}
          key={item.id}
          onClick={() => {
            if (item.disabled) return;
            item.onSelect();
            onClose();
          }}
          role="menuitem"
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.querySelector('.app-shell') ?? document.body
  );
}
