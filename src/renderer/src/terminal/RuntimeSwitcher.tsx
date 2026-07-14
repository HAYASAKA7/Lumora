import type { ReactNode } from 'react';

import type { RuntimeSummary } from '../../../shared/contracts';

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

export function RuntimeSwitcher({
  runtimes,
  selectedRuntimeId
}: {
  runtimes: readonly RuntimeSummary[];
  selectedRuntimeId: string;
}): ReactNode {
  return (
    <div className="runtime-switcher-layer">
      <section
        aria-label="Open terminals"
        aria-live="polite"
        className="runtime-switcher"
        role="dialog"
      >
        <p className="runtime-switcher-title">Open terminals</p>
        <div aria-label="Terminal switcher" className="runtime-switcher-list" role="listbox">
          {runtimes.map((runtime) => {
            const selected = runtime.id === selectedRuntimeId;
            return (
              <div
                aria-selected={selected}
                className={`runtime-switcher-option${selected ? ' is-selected' : ''}`}
                key={runtime.id}
                role="option"
              >
                <span className="runtime-switcher-provider" aria-hidden="true">
                  {runtime.provider === 'codex' ? 'C' : 'A'}
                </span>
                <span>
                  <strong>{runtime.displayName}</strong>
                  <small>
                    {runtime.provider === 'codex' ? 'Codex' : 'Claude Code'} · {runtime.state}
                  </small>
                </span>
              </div>
            );
          })}
        </div>
        <p className="runtime-switcher-hint">Keep holding the modifier and press the shortcut again to cycle.</p>
      </section>
    </div>
  );
}
