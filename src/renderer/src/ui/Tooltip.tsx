import {
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEventHandler,
  type MouseEventHandler,
  type PointerEventHandler,
  type ReactElement,
  type ReactNode,
  type Ref
} from 'react';
import { createPortal } from 'react-dom';

import { placeTooltip, type TooltipPlacement } from './tooltip-position';

const INITIAL_DELAY_MS = 450;
const WARM_DELAY_MS = 80;
const WARM_WINDOW_MS = 600;

type InputModality = 'keyboard' | 'pointer';

interface ActiveTooltip {
  content: ReactNode;
  id: string;
  multiline: boolean;
  shortcut: string | undefined;
  trigger: HTMLElement;
}

interface OpenTooltipRequest extends ActiveTooltip {
  source: 'focus' | 'pointer';
}

interface TooltipContextValue {
  activeId: string | null;
  close: (id?: string) => void;
  open: (request: OpenTooltipRequest) => void;
}

const TooltipContext = createContext<TooltipContextValue>({
  activeId: null,
  close: () => undefined,
  open: () => undefined
});

export interface TooltipProviderProps {
  children: ReactNode;
}

function isKeyboardNavigation(event: KeyboardEvent): boolean {
  return event.key === 'Tab' || event.key.startsWith('Arrow');
}

export function TooltipProvider({
  children
}: TooltipProviderProps): React.JSX.Element {
  const [active, setActive] = useState<ActiveTooltip | null>(null);
  const [placement, setPlacement] = useState<TooltipPlacement>({
    left: -10_000,
    top: -10_000,
    placement: 'top'
  });
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const inputModality = useRef<InputModality>('pointer');
  const openTimer = useRef<number | null>(null);
  const pendingId = useRef<string | null>(null);
  const warm = useRef(false);
  const warmTimer = useRef<number | null>(null);

  const clearOpenTimer = useCallback(() => {
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    openTimer.current = null;
    pendingId.current = null;
  }, []);

  const startWarmWindow = useCallback(() => {
    warm.current = true;
    if (warmTimer.current !== null) window.clearTimeout(warmTimer.current);
    warmTimer.current = window.setTimeout(() => {
      warm.current = false;
      warmTimer.current = null;
    }, WARM_WINDOW_MS);
  }, []);

  const close = useCallback(
    (id?: string) => {
      if (id === undefined || pendingId.current === id) clearOpenTimer();
      setActive((current) => {
        if (current === null || (id !== undefined && current.id !== id)) {
          return current;
        }
        startWarmWindow();
        return null;
      });
    },
    [clearOpenTimer, startWarmWindow]
  );

  const open = useCallback(
    (request: OpenTooltipRequest) => {
      clearOpenTimer();
      if (request.source === 'focus' && inputModality.current !== 'keyboard') {
        return;
      }
      const delay =
        request.source === 'focus'
          ? 0
          : warm.current
            ? WARM_DELAY_MS
            : INITIAL_DELAY_MS;
      const show = () => {
        pendingId.current = null;
        openTimer.current = null;
        const next: ActiveTooltip = {
          content: request.content,
          id: request.id,
          multiline: request.multiline,
          shortcut: request.shortcut,
          trigger: request.trigger
        };
        setActive(next);
      };
      pendingId.current = request.id;
      if (delay === 0) {
        show();
      } else {
        openTimer.current = window.setTimeout(show, delay);
      }
    },
    [clearOpenTimer]
  );

  useEffect(() => {
    const pointer = () => {
      inputModality.current = 'pointer';
    };
    const keydown = (event: KeyboardEvent) => {
      if (isKeyboardNavigation(event)) inputModality.current = 'keyboard';
      if (event.key === 'Escape') close();
    };
    const dismiss = () => close();

    window.addEventListener('pointerdown', pointer, true);
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      window.removeEventListener('pointerdown', pointer, true);
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
      clearOpenTimer();
      if (warmTimer.current !== null) window.clearTimeout(warmTimer.current);
    };
  }, [clearOpenTimer, close]);

  useLayoutEffect(() => {
    if (active === null || bubbleRef.current === null) return;
    if (!active.trigger.isConnected) {
      close(active.id);
      return;
    }
    const trigger = active.trigger.getBoundingClientRect();
    const bubble = bubbleRef.current.getBoundingClientRect();
    setPlacement(
      placeTooltip({
        trigger,
        tooltip: { width: bubble.width, height: bubble.height },
        viewport: { width: window.innerWidth, height: window.innerHeight }
      })
    );
  }, [active, close]);

  const value = useMemo<TooltipContextValue>(
    () => ({ activeId: active?.id ?? null, close, open }),
    [active?.id, close, open]
  );

  return (
    <TooltipContext.Provider value={value}>
      {children}
      {active === null
        ? null
        : createPortal(
            <div
              className={`lumora-tooltip${
                active.multiline ? ' lumora-tooltip-multiline' : ''
              }`}
              data-placement={placement.placement}
              id={active.id}
              ref={bubbleRef}
              role="tooltip"
              style={{ left: placement.left, top: placement.top }}
            >
              <span className="lumora-tooltip-content">{active.content}</span>
              {active.shortcut === undefined ? null : (
                <span className="lumora-tooltip-shortcut">
                  {active.shortcut}
                </span>
              )}
            </div>,
            active.trigger.closest('.app-shell') ?? document.body
          )}
    </TooltipContext.Provider>
  );
}

interface TooltipChildProps {
  'aria-describedby'?: string | undefined;
  onBlur?: FocusEventHandler<HTMLElement>;
  onClick?: MouseEventHandler<HTMLElement>;
  onFocus?: FocusEventHandler<HTMLElement>;
  onPointerEnter?: PointerEventHandler<HTMLElement>;
  onPointerLeave?: PointerEventHandler<HTMLElement>;
  ref?: Ref<HTMLElement>;
}

export interface TooltipProps {
  children: ReactElement<TooltipChildProps>;
  content: ReactNode | null;
  focus?: boolean;
  multiline?: boolean;
  shortcut?: string | undefined;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') {
    ref(value);
  } else if (ref !== null && ref !== undefined) {
    ref.current = value;
  }
}

export function Tooltip({
  children,
  content,
  focus = true,
  multiline = false,
  shortcut
}: TooltipProps): React.JSX.Element {
  const context = useContext(TooltipContext);
  if (!isValidElement<TooltipChildProps>(children)) {
    throw new Error('Tooltip requires one element child.'); // i18n-ignore: developer invariant
  }

  const { activeId, close, open: requestOpen } = context;
  const generatedId = useId();
  const tooltipId = `lumora-tooltip-${generatedId.replaceAll(':', '')}`;
  const triggerRef = useRef<HTMLElement | null>(null);
  const childProps = children.props;

  useEffect(() => () => close(tooltipId), [close, tooltipId]);

  const setRef = useCallback(
    (node: HTMLElement | null) => {
      triggerRef.current = node;
      assignRef(childProps.ref, node);
    },
    [childProps.ref]
  );

  const openTooltip = useCallback(
    (source: OpenTooltipRequest['source'], trigger: HTMLElement) => {
      if (content === null) return;
      requestOpen({
        content,
        id: tooltipId,
        multiline,
        shortcut,
        source,
        trigger
      });
    },
    [content, multiline, requestOpen, shortcut, tooltipId]
  );

  const describedBy = [
    childProps['aria-describedby'],
    activeId === tooltipId ? tooltipId : undefined
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ');

  return cloneElement(children, {
    'aria-describedby': describedBy || undefined,
    onBlur: (event) => {
      childProps.onBlur?.(event);
      close(tooltipId);
    },
    onClick: (event) => {
      childProps.onClick?.(event);
      close(tooltipId);
    },
    onFocus: (event) => {
      childProps.onFocus?.(event);
      if (focus) openTooltip('focus', event.currentTarget);
    },
    onPointerEnter: (event) => {
      childProps.onPointerEnter?.(event);
      openTooltip('pointer', event.currentTarget);
    },
    onPointerLeave: (event) => {
      childProps.onPointerLeave?.(event);
      close(tooltipId);
    },
    ref: setRef
  });
}

export interface OverflowTooltipProps {
  children: ReactElement<TooltipChildProps>;
  content: ReactNode;
}

export function OverflowTooltip({
  children,
  content
}: OverflowTooltipProps): React.JSX.Element {
  const [overflowing, setOverflowing] = useState(false);
  const elementRef = useRef<HTMLElement | null>(null);
  const childRef = children.props.ref;

  const measure = useCallback(() => {
    const element = elementRef.current;
    setOverflowing(
      element !== null &&
        (element.scrollWidth > element.clientWidth ||
          element.scrollHeight > element.clientHeight)
    );
  }, []);

  const setRef = useCallback(
    (node: HTMLElement | null) => {
      elementRef.current = node;
      assignRef(childRef, node);
    },
    [childRef]
  );

  useLayoutEffect(measure, [content, measure]);

  useEffect(() => {
    if (elementRef.current === null || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(elementRef.current);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <Tooltip content={overflowing ? content : null}>
      {cloneElement(children, { ref: setRef })}
    </Tooltip>
  );
}
