import { useEffect, useRef, type ReactNode } from 'react';

import type { RuntimeSummary, WorkspaceSummary } from '../../../shared/contracts';
import { providerDefinition } from '../../../shared/provider-definitions';
import { useLocalization } from '../localization/useLocalization';

export interface RuntimeSwitcherState {
  order: string[];
  selectedRuntimeId: string;
}

export function touchRuntimeMru(
  order: readonly string[],
  runtimeId: string
): string[] {
  return [runtimeId, ...order.filter((id) => id !== runtimeId)];
}

export function buildRuntimeMru(
  openRuntimeIds: readonly string[],
  currentMru: readonly string[],
  activeRuntimeId: string | null
): string[] {
  const open = new Set(openRuntimeIds);
  const seen = new Set<string>();
  const next = currentMru.filter((id) => {
    if (!open.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  for (const id of openRuntimeIds) {
    if (!seen.has(id)) {
      seen.add(id);
      next.push(id);
    }
  }
  return activeRuntimeId !== null && open.has(activeRuntimeId)
    ? touchRuntimeMru(next, activeRuntimeId)
    : next;
}

export function nextRuntimeInOrder(
  order: readonly string[],
  currentRuntimeId: string | null
): string | null {
  if (order.length === 0) return null;
  const currentIndex = currentRuntimeId === null
    ? -1
    : order.indexOf(currentRuntimeId);
  return order[(currentIndex + 1) % order.length] ?? order[0] ?? null;
}

export function reconcileRuntimeSwitch(
  state: RuntimeSwitcherState,
  validRuntimeIds: readonly string[]
): RuntimeSwitcherState | null {
  const valid = new Set(validRuntimeIds);
  const order = state.order.filter((id) => valid.has(id));
  for (const id of validRuntimeIds) {
    if (!order.includes(id)) order.push(id);
  }
  if (order.length === 0) return null;
  if (valid.has(state.selectedRuntimeId)) {
    return { order, selectedRuntimeId: state.selectedRuntimeId };
  }
  const removedIndex = state.order.indexOf(state.selectedRuntimeId);
  if (removedIndex >= 0) {
    for (let offset = 1; offset <= state.order.length; offset += 1) {
      const candidate = state.order[
        (removedIndex + offset) % state.order.length
      ];
      if (candidate !== undefined && valid.has(candidate)) {
        return { order, selectedRuntimeId: candidate };
      }
    }
  }
  return { order, selectedRuntimeId: order[0]! };
}

export function RuntimeSwitcher({
  runtimes,
  selectedRuntimeId,
  workspaces
}: {
  runtimes: readonly RuntimeSummary[];
  selectedRuntimeId: string;
  workspaces: readonly WorkspaceSummary[];
}): ReactNode {
  const { t } = useLocalization();
  const listboxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    listboxRef.current?.focus();
    return () => {
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <div className="runtime-switcher-layer">
      <section
        aria-label={t('terminal.runtime.switcher-title')}
        aria-live="polite"
        aria-modal="true"
        className="runtime-switcher"
        role="dialog"
      >
        <p className="runtime-switcher-title">{t('terminal.runtime.switcher-title')}</p>
        <div
          aria-activedescendant={`runtime-switcher-option-${selectedRuntimeId}`}
          aria-label={t('terminal.runtime.switcher-label')}
          className="runtime-switcher-list"
          ref={listboxRef}
          role="listbox"
          tabIndex={-1}
        >
          {runtimes.map((runtime) => {
            const selected = runtime.id === selectedRuntimeId;
            const workspace = workspaces.find(
              (item) => item.id === runtime.workspaceId
            );
            return (
              <div
                aria-selected={selected}
                className={`runtime-switcher-option${selected ? ' is-selected' : ''}`}
                id={`runtime-switcher-option-${runtime.id}`}
                key={runtime.id}
                role="option"
              >
                <span className="runtime-switcher-provider" aria-hidden="true">
                  {runtime.provider === 'codex' ? 'C' : 'A'}
                </span>
                <span>
                  <strong>{runtime.displayName}</strong>
                  <small>
                    {providerDefinition(runtime.provider).displayName} · {workspace?.displayName ?? t('terminal.runtime.workspace-fallback')}
                  </small>
                </span>
              </div>
            );
          })}
        </div>
        <p className="runtime-switcher-hint">{t('terminal.runtime.switcher-hint')}</p>
      </section>
    </div>
  );
}
