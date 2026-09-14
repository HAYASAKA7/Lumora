import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode
} from 'react';
import { createPortal } from 'react-dom';

import { placeMenu } from './menu-placement';

export interface ActionMenuItem<Id extends string> {
  id: Id;
  label: string;
  disabled?: boolean;
}

interface ActionMenuProps<Id extends string> {
  /**
   * Which edge of the trigger the menu lines up with. A menu at the right of
   * a row hangs from its right edge; one at the left edge of a box hangs
   * from its left, so it does not reach across what it belongs to.
   */
  align?: 'start' | 'end';
  children: ReactNode;
  items: readonly ActionMenuItem<Id>[];
  label: string;
  onSelect(id: Id): void;
  className?: string;
  disabled?: boolean;
}

export function ActionMenu<Id extends string>({
  align = 'end',
  children,
  className,
  disabled = false,
  items,
  label,
  onSelect
}: ActionMenuProps<Id>): ReactNode {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [overlayStyle, setOverlayStyle] = useState<CSSProperties>({
    left: -10_000,
    position: 'fixed',
    top: -10_000
  });

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target) &&
        !menuRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || triggerRef.current === null) return;
    const place = () => {
      const trigger = triggerRef.current;
      if (trigger === null || !trigger.isConnected) {
        setOpen(false);
        return;
      }
      setOverlayStyle(placeMenu(
        trigger.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight },
        { align, itemCount: items.length, minWidth: 164, maxWidth: 360 }
      ));
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [align, items.length, open]);

  const choose = (index: number) => {
    const item = items[index];
    if (item === undefined || item.disabled) return;
    onSelect(item.id);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const move = (direction: -1 | 1) => {
    if (items.length === 0) return;
    setOpen(true);
    setActiveIndex((current) => {
      let candidate = open ? current : direction === 1 ? -1 : 0;
      for (let offset = 0; offset < items.length; offset += 1) {
        candidate = (candidate + direction + items.length) % items.length;
        if (!items[candidate]?.disabled) return candidate;
      }
      return current;
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      move(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && open) {
      event.preventDefault();
      choose(activeIndex);
    }
  };

  return (
    <div className="action-menu" ref={rootRef}>
      <button
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        className={className}
        data-lumora-command
        disabled={disabled || items.length === 0}
        onClick={() => {
          setActiveIndex(0);
          setOpen((current) => !current);
        }}
        onKeyDown={handleKeyDown}
        ref={triggerRef}
        tabIndex={-1}
        type="button"
      >
        {children}
      </button>
      {open
        ? createPortal(
            <div
              aria-label={label}
              className="select-menu-options select-menu-options-overlay action-menu-options"
              id={menuId}
              ref={menuRef}
              role="menu"
              style={overlayStyle}
            >
              {items.map((item, index) => (
                <button
                  className={`select-menu-option${index === activeIndex ? ' is-active' : ''}`}
                  data-lumora-command
                  disabled={item.disabled}
                  key={item.id}
                  onClick={() => choose(index)}
                  onPointerEnter={() => setActiveIndex(index)}
                  role="menuitem"
                  tabIndex={-1}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>,
            triggerRef.current?.closest('.app-shell') ?? document.body
          )
        : null}
    </div>
  );
}
