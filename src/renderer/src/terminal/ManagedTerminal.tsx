import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import '@xterm/xterm/css/xterm.css';

import type {
  RuntimeEvent,
  RuntimeSummary,
  SystemInfo
} from '../../../shared/contracts';
import { classifyTerminalClipboardKey } from './terminal-clipboard';
import {
  decideTerminalInterrupt,
  TERMINAL_INTERRUPT_CONFIRMATION_MS
} from './terminal-interrupt-guard';

interface ManagedTerminalProps {
  active: boolean;
  focusRequestKey?: number;
  platform: SystemInfo['platform'];
  runtime: RuntimeSummary;
  onRuntimeChange(runtime: RuntimeSummary): void;
}

const TERMINAL_BLOCK_SIZE = '100%';

export function ManagedTerminal({
  active,
  focusRequestKey = 0,
  platform,
  runtime,
  onRuntimeChange
}: ManagedTerminalProps): ReactNode {
  const container = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef(active);
  const platformRef = useRef(platform);
  const terminalRef = useRef<import('@xterm/xterm').Terminal | null>(null);
  const fitAddonRef = useRef<import('@xterm/addon-fit').FitAddon | null>(null);
  const interruptDeadlineRef = useRef<number | null>(null);
  const interruptTimerRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [interruptArmed, setInterruptArmed] = useState(false);
  activeRef.current = active;
  platformRef.current = platform;

  const clearInterruptGuard = useCallback(() => {
    interruptDeadlineRef.current = null;
    if (interruptTimerRef.current !== null) {
      window.clearTimeout(interruptTimerRef.current);
      interruptTimerRef.current = null;
    }
    setInterruptArmed(false);
  }, []);

  useEffect(() => {
    clearInterruptGuard();
    const target = container.current;
    if (target === null) return;
    let alive = true;
    let dispose = () => undefined;
    void Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]).then(
      ([{ Terminal }, { FitAddon }]) => {
        if (!alive) return;
        const terminal = new Terminal({
          cursorBlink: true,
          fontFamily: 'Cascadia Mono, SFMono-Regular, Consolas, monospace',
          fontSize: 13,
          scrollback: 5_000,
          theme: {
            background: '#07111f',
            foreground: '#d8e2ef',
            cursor: '#7aa2ff',
            selectionBackground: '#294b78'
          }
        });
        const fitAddon = new FitAddon();
        terminalRef.current = terminal;
        fitAddonRef.current = fitAddon;
        terminal.loadAddon(fitAddon);
        terminal.parser.registerOscHandler(52, () => true);
        terminal.open(target);
        terminal.attachCustomKeyEventHandler((event) => {
          const action = classifyTerminalClipboardKey(
            event,
            platformRef.current,
            terminal.hasSelection()
          );
          if (event.type === 'keydown' && action !== 'interrupt') {
            clearInterruptGuard();
          }
          if (action === 'terminal') return true;

          if (action === 'interrupt') {
            const decision = decideTerminalInterrupt(
              interruptDeadlineRef.current,
              Date.now(),
              event.repeat
            );
            interruptDeadlineRef.current = decision.armedUntil;

            if (decision.action === 'forward') {
              clearInterruptGuard();
              return true;
            }

            event.preventDefault();
            event.stopPropagation();
            if (decision.action === 'arm') {
              if (interruptTimerRef.current !== null) {
                window.clearTimeout(interruptTimerRef.current);
              }
              if (alive) setInterruptArmed(true);
              interruptTimerRef.current = window.setTimeout(
                clearInterruptGuard,
                TERMINAL_INTERRUPT_CONFIRMATION_MS
              );
            }
            return false;
          }

          event.preventDefault();
          event.stopPropagation();
          if (alive) setError(null);

          if (action === 'copy') {
            const selected = terminal.getSelection();
            if (selected.length > 0) {
              void window.lumora.writeClipboardText(selected).catch(() => {
                if (alive) setError('Selected text could not be copied.');
              });
            }
            return false;
          }

          void window.lumora.readClipboardText().then(
            (text) => {
              if (!alive || text.length === 0) return;
              terminal.paste(text);
              if (activeRef.current) terminal.focus();
            },
            () => {
              if (alive) setError('Clipboard text could not be pasted.');
            }
          );
          return false;
        });
        fitAddon.fit();

        const input = terminal.onData((data) => {
          void window.lumora.writeRuntime({ runtimeId: runtime.id, data }).catch(() => {
            if (alive) setError('Terminal input could not be delivered.');
          });
        });
        const resize = terminal.onResize(({ cols, rows }) => {
          void window.lumora.resizeRuntime({ runtimeId: runtime.id, cols, rows }).catch(() => undefined);
        });
        let attached = false;
        let outputSequence = 0;
        let pendingOutput: Extract<RuntimeEvent, { type: 'output' }>[] = [];
        const writeOutput = (
          event: Extract<RuntimeEvent, { type: 'output' }>
        ) => {
          if (event.sequence <= outputSequence) return;
          terminal.write(event.data);
          outputSequence = event.sequence;
        };
        const unsubscribe = window.lumora.onRuntimeEvent((event) => {
          if (event.runtimeId !== runtime.id) return;
          if (event.type === 'output') {
            if (attached) writeOutput(event);
            else pendingOutput.push(event);
          } else onRuntimeChange(event.runtime);
        });
        const observer =
          typeof ResizeObserver === 'undefined'
            ? null
            : new ResizeObserver(() => fitAddon.fit());
        observer?.observe(target);
        dispose = () => {
          observer?.disconnect();
          unsubscribe();
          input.dispose();
          resize.dispose();
          terminal.dispose();
        };

        void window.lumora.attachRuntime(runtime.id).then(
          (attachment) => {
            if (!alive) return;
            if (attachment.snapshot.length > 0) terminal.write(attachment.snapshot);
            outputSequence = attachment.outputSequence;
            attached = true;
            pendingOutput
              .sort((left, right) => left.sequence - right.sequence)
              .forEach(writeOutput);
            pendingOutput = [];
            onRuntimeChange(attachment.runtime);
            if (activeRef.current) terminal.focus();
          },
          () => { if (alive) setError('The terminal runtime could not be attached.'); }
        );
      },
      () => { if (alive) setError('The terminal renderer could not be loaded.'); }
    );

    return () => {
      alive = false;
      interruptDeadlineRef.current = null;
      if (interruptTimerRef.current !== null) {
        window.clearTimeout(interruptTimerRef.current);
        interruptTimerRef.current = null;
      }
      terminalRef.current = null;
      fitAddonRef.current = null;
      dispose();
    };
  }, [runtime.id, onRuntimeChange, clearInterruptGuard]);

  useEffect(() => {
    if (!active) {
      clearInterruptGuard();
      return;
    }
    fitAddonRef.current?.fit();
    terminalRef.current?.focus();
  }, [active, clearInterruptGuard, focusRequestKey]);

  return (
    <div className="managed-terminal-shell">
      {error === null ? null : <div className="terminal-error" role="alert">{error}</div>}
      {interruptArmed ? (
        <div className="terminal-interrupt-notice" role="status">
          Press Ctrl+C again to interrupt
        </div>
      ) : null}
      <div
        aria-label={`${runtime.provider} terminal`}
        className="managed-terminal"
        ref={container}
        style={{ blockSize: TERMINAL_BLOCK_SIZE }}
      />
    </div>
  );
}
