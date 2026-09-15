import type { ReactNode } from 'react';

export interface ChangesModeOption<T extends string> {
  id: T;
  label: string;
  disabled?: boolean;
}

interface ChangesModeSwitchProps<T extends string> {
  options: readonly ChangesModeOption<T>[];
  selected: T;
  onSelect(id: T): void;
}

/** A row of mutually exclusive choices, such as this session, all uncommitted and history. */
export function ChangesModeSwitch<T extends string>({ onSelect, options, selected }: ChangesModeSwitchProps<T>): ReactNode {
  return (
    <div className="changes-view-switch">
      {options.map((option) => (
        <button
          aria-pressed={option.id === selected}
          className="changes-view-switch-button"
          disabled={option.disabled === true}
          key={option.id}
          onClick={() => onSelect(option.id)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
