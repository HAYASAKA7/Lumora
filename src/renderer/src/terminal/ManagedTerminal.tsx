import { useEffect, useRef, useState, type ReactNode } from 'react';
import '@xterm/xterm/css/xterm.css';

import type { RuntimeEvent, RuntimeSummary } from '../../../shared/contracts';

interface ManagedTerminalProps {
  runtime: RuntimeSummary;
  onRuntimeChange(runtime: RuntimeSummary): void;
}

const TERMINAL_BLOCK_SIZE = 'clamp(360px, 55vh, 620px)';

export function ManagedTerminal({
  runtime,
  onRuntimeChange
}: ManagedTerminalProps): ReactNode {
  const container = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const target = container.current;
    if (target === null) return;
    let active = true;
    let dispose = () => undefined;
    void Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]).then(
      ([{ Terminal }, { FitAddon }]) => {
        if (!active) return;
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
        terminal.loadAddon(fitAddon);
        terminal.parser.registerOscHandler(52, () => true);
        terminal.open(target);
        fitAddon.fit();

        const input = terminal.onData((data) => {
          void window.lumora.writeRuntime({ runtimeId: runtime.id, data }).catch(() => {
            if (active) setError('Terminal input could not be delivered.');
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
            if (!active) return;
            if (attachment.snapshot.length > 0) terminal.write(attachment.snapshot);
            outputSequence = attachment.outputSequence;
            attached = true;
            pendingOutput
              .sort((left, right) => left.sequence - right.sequence)
              .forEach(writeOutput);
            pendingOutput = [];
            onRuntimeChange(attachment.runtime);
            terminal.focus();
          },
          () => { if (active) setError('The terminal runtime could not be attached.'); }
        );
      },
      () => { if (active) setError('The terminal renderer could not be loaded.'); }
    );

    return () => {
      active = false;
      dispose();
    };
  }, [runtime.id, onRuntimeChange]);

  return (
    <div className="managed-terminal-shell">
      {error === null ? null : <div className="terminal-error" role="alert">{error}</div>}
      <div
        aria-label={`${runtime.provider} terminal`}
        className="managed-terminal"
        ref={container}
        style={{ blockSize: TERMINAL_BLOCK_SIZE }}
      />
    </div>
  );
}
