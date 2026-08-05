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

export interface SelectMenuOption<Value extends string> {
  value: Value;
  label: string;
}

interface SelectMenuProps<Value extends string> {
  label: string;
  onChange(value: Value): void;
  options: readonly SelectMenuOption<Value>[];
  value: Value;
  disabled?: boolean;
}

export function SelectMenu<Value extends string>({
  disabled = false,
  label,
  onChange,
  options,
  value
}: SelectMenuProps<Value>): ReactNode {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listboxId = useId();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [overlayStyle, setOverlayStyle] = useState<CSSProperties>({
    left: -10_000,
    position: 'fixed',
    top: -10_000
  });
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  );
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const selected = options[selectedIndex];

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
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || triggerRef.current === null) return;
    const place = () => {
      const trigger = triggerRef.current;
      if (trigger === null || !trigger.isConnected) {
        setOpen(false);
        return;
      }
      const rect = trigger.getBoundingClientRect();
      const gap = 6;
      const margin = 8;
      const availableBelow = window.innerHeight - rect.bottom - gap - margin;
      const availableAbove = rect.top - gap - margin;
      const openAbove =
        availableBelow < 120 && availableAbove > availableBelow;
      const maxHeight = Math.min(
        220,
        Math.max(72, openAbove ? availableAbove : availableBelow)
      );
      setOverlayStyle({
        left: Math.max(
          margin,
          Math.min(rect.left, window.innerWidth - rect.width - margin)
        ),
        maxHeight,
        position: 'fixed',
        top: openAbove
          ? Math.max(margin, rect.top - gap - maxHeight)
          : rect.bottom + gap,
        width: rect.width
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  const moveActive = (direction: -1 | 1) => {
    setOpen(true);
    setActiveIndex((current) => {
      const start = open ? current : selectedIndex;
      return (start + direction + options.length) % options.length;
    });
  };

  const choose = (index: number) => {
    const option = options[index];
    if (option === undefined) return;
    onChange(option.value);
    setActiveIndex(index);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(event.key === 'Home' ? 0 : options.length - 1);
      return;
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && open) {
      event.preventDefault();
      choose(activeIndex);
    }
  };

  return (
    <div className="select-menu" ref={rootRef}>
      <button
        aria-controls={open ? listboxId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={label}
        className="select-menu-trigger"
        disabled={disabled || options.length === 0}
        onClick={() => {
          setActiveIndex(selectedIndex);
          setOpen((current) => !current);
        }}
        onKeyDown={handleKeyDown}
        ref={triggerRef}
        type="button"
      >
        <span className="select-menu-value">{selected?.label ?? 'Unavailable'}</span>
        <span aria-hidden="true" className="select-menu-chevron">⌄</span>
      </button>
      {open
        ? createPortal(
            <div
              aria-label={`${label} options`}
              className="select-menu-options select-menu-options-overlay"
              id={listboxId}
              ref={menuRef}
              role="listbox"
              style={overlayStyle}
            >
              {options.map((option, index) => (
                <button
                  aria-selected={option.value === value}
                  className={`select-menu-option${index === activeIndex ? ' is-active' : ''}`}
                  key={option.value}
                  onClick={() => choose(index)}
                  onPointerEnter={() => setActiveIndex(index)}
                  role="option"
                  type="button"
                >
                  <span>{option.label}</span>
                  {option.value === value ? (
                    <span aria-hidden="true" className="select-menu-check">✓</span>
                  ) : null}
                </button>
              ))}
            </div>,
            triggerRef.current?.closest('.app-shell') ?? document.body
          )
        : null}
    </div>
  );
}
