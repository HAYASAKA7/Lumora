export const TERMINAL_INTERRUPT_CONFIRMATION_MS = 1_500;

export interface TerminalInterruptDecision {
  action: 'arm' | 'block' | 'forward';
  armedUntil: number | null;
}

export function decideTerminalInterrupt(
  armedUntil: number | null,
  now: number,
  repeat: boolean
): TerminalInterruptDecision {
  if (repeat) {
    return { action: 'block', armedUntil };
  }

  if (armedUntil !== null && now <= armedUntil) {
    return { action: 'forward', armedUntil: null };
  }

  return {
    action: 'arm',
    armedUntil: now + TERMINAL_INTERRUPT_CONFIRMATION_MS
  };
}
