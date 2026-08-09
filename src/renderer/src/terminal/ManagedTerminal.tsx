import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import '@xterm/xterm/css/xterm.css';

import type {
  RuntimeEvent,
  RuntimeSummary,
  SystemInfo
} from '../../../shared/contracts';
import { classifyTerminalClipboardKey } from './terminal-clipboard';
import { createTerminalExitIntentTracker } from './terminal-exit-intent';
import {
  decideTerminalInterrupt,
  TERMINAL_INTERRUPT_CONFIRMATION_MS
} from './terminal-interrupt-guard';
import { encodeTerminalNativeKey } from './terminal-native-key';

interface ManagedTerminalProps {
  active: boolean;
  backgroundOpacity?: number;
  focusRequestKey?: number;
  platform: SystemInfo['platform'];
  runtime: RuntimeSummary;
  theme?: 'light' | 'dark';
  onRuntimeChange(runtime: RuntimeSummary): void;
}

const TERMINAL_BLOCK_SIZE = '100%';
const TERMINAL_INPUT_CHUNK_SIZE = 60_000;
export const TERMINAL_EXIT_GRACE_MS = 2_000;

const TERMINAL_THEMES = {
  dark: {
    background: '#07111f',
    foreground: '#d8e2ef',
    cursor: '#7aa2ff',
    selectionBackground: '#294b78'
  },
  light: {
    background: '#f7f9fc',
    foreground: '#172033',
    cursor: '#296dff',
    selectionBackground: '#c9dcff'
  }
} as const;

function terminalPalette(theme: 'light' | 'dark', backgroundOpacity: number) {
  const palette = TERMINAL_THEMES[theme];
  if (backgroundOpacity >= 1) return palette;
  return {
    ...palette,
    background: 'rgba(0, 0, 0, 0)'
  };
}

function isRuntimeLive(runtime: RuntimeSummary): boolean {
  return runtime.state === 'launching' || runtime.state === 'running';
}

export function ManagedTerminal({
  active,
  backgroundOpacity = 1,
  focusRequestKey = 0,
  platform,
  runtime,
  theme = 'dark',
  onRuntimeChange
}: ManagedTerminalProps): ReactNode {
  const container = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef(active);
  const platformRef = useRef(platform);
  const terminalRef = useRef<import('@xterm/xterm').Terminal | null>(null);
  const themeRef = useRef({ theme, backgroundOpacity });
  const fitAddonRef = useRef<import('@xterm/addon-fit').FitAddon | null>(null);
  const interruptDeadlineRef = useRef<number | null>(null);
  const acceptingInputRef = useRef(isRuntimeLive(runtime));
  const interruptTimerRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [interruptArmed, setInterruptArmed] = useState(false);
  activeRef.current = active;
  platformRef.current = platform;
  themeRef.current = { theme, backgroundOpacity };

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
          allowTransparency: true,
          cursorBlink: true,
          fontFamily: 'Cascadia Mono, SFMono-Regular, Consolas, monospace',
          fontSize: 13,
          scrollback: 5_000,
          theme: terminalPalette(
            themeRef.current.theme,
            themeRef.current.backgroundOpacity
          ),
          linkHandler: {
            activate: (_event, uri) => {
              const confirmed = window.confirm(
                `Open this link in your default browser?\n\n${uri}`
              );
              if (!confirmed || !alive) return;
              setError(null);
              void window.lumora.openTerminalLink(uri).catch(() => {
                if (alive) setError('The terminal link could not be opened.');
              });
            }
          }
        });
        const fitAddon = new FitAddon();
        terminalRef.current = terminal;
        fitAddonRef.current = fitAddon;
        terminal.loadAddon(fitAddon);
        terminal.parser.registerOscHandler(52, () => true);
        terminal.open(target);
        const pasteClipboardText = () => {
          if (!alive || !acceptingInputRef.current) return;
          setError(null);
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
        };
        const contextMenu = (event: MouseEvent) => {
          if (!acceptingInputRef.current) return;
          event.preventDefault();
          event.stopPropagation();
          pasteClipboardText();
        };
        target.addEventListener('contextmenu', contextMenu);
        const exitIntent = createTerminalExitIntentTracker(runtime.provider);
        let exitFallbackTimer: number | null = null;
        let terminationPending = false;
        let observedRuntimeEnded = !isRuntimeLive(runtime);
        const clearExitFallback = () => {
          if (exitFallbackTimer === null) return;
          window.clearTimeout(exitFallbackTimer);
          exitFallbackTimer = null;
        };
        const requestTermination = () => {
          if (
            !alive ||
            terminationPending ||
            observedRuntimeEnded ||
            !acceptingInputRef.current
          ) {
            return;
          }
          terminationPending = true;
          acceptingInputRef.current = false;
          clearExitFallback();
          clearInterruptGuard();
          setError(null);
          void window.lumora.terminateRuntime(runtime.id).then(
            (nextRuntime) => {
              if (!alive) return;
              observedRuntimeEnded = !isRuntimeLive(nextRuntime);
              onRuntimeChange(nextRuntime);
            },
            () => {
              if (!alive) return;
              terminationPending = false;
              acceptingInputRef.current = !observedRuntimeEnded;
              setError('The terminal session could not be stopped.');
            }
          );
        };
        const scheduleExitFallback = () => {
          clearExitFallback();
          exitFallbackTimer = window.setTimeout(() => {
            exitFallbackTimer = null;
            requestTermination();
          }, TERMINAL_EXIT_GRACE_MS);
        };
        let inputWriteChain = Promise.resolve();
        const writeRuntimeInput = (
          data: string,
          options: { observeExitIntent?: boolean } = {}
        ) => {
          if (!acceptingInputRef.current) return;
          const submittedExit =
            options.observeExitIntent === false
              ? false
              : exitIntent.observe(data);
          const chunks: string[] = [];
          for (
            let offset = 0;
            offset < data.length;
            offset += TERMINAL_INPUT_CHUNK_SIZE
          ) {
            chunks.push(data.slice(offset, offset + TERMINAL_INPUT_CHUNK_SIZE));
          }
          const queuedWrite = inputWriteChain.then(async () => {
            for (const chunk of chunks) {
              if (!alive || !acceptingInputRef.current) return;
              await window.lumora.writeRuntime({
                runtimeId: runtime.id,
                data: chunk
              });
            }
          });
          inputWriteChain = queuedWrite.catch(() => undefined);
          void queuedWrite.then(
            () => {
              if (submittedExit && alive && acceptingInputRef.current) {
                scheduleExitFallback();
              }
            },
            () => {
              if (alive) setError('Terminal input could not be delivered.');
            }
          );
        };
        let composing = false;
        let outputFlushTimer: number | null = null;
        let deferredOutput: string[] = [];
        const flushDeferredOutput = () => {
          outputFlushTimer = null;
          if (!alive || composing || deferredOutput.length === 0) return;
          const output = deferredOutput.join('');
          deferredOutput = [];
          terminal.write(output);
        };
        const scheduleOutputFlush = () => {
          if (outputFlushTimer !== null) return;
          outputFlushTimer = window.setTimeout(flushDeferredOutput, 0);
        };
        const writeTerminalOutput = (data: string) => {
          if (composing || outputFlushTimer !== null) {
            deferredOutput.push(data);
            return;
          }
          terminal.write(data);
        };
        const compositionStart = () => {
          composing = true;
          if (outputFlushTimer !== null) {
            window.clearTimeout(outputFlushTimer);
            outputFlushTimer = null;
          }
        };
        const compositionEnd = () => {
          composing = false;
          scheduleOutputFlush();
        };
        const compositionBlur = () => {
          if (!composing) return;
          composing = false;
          scheduleOutputFlush();
        };
        terminal.textarea?.addEventListener('compositionstart', compositionStart);
        terminal.textarea?.addEventListener('compositionend', compositionEnd);
        terminal.textarea?.addEventListener('blur', compositionBlur);
        terminal.attachCustomKeyEventHandler((event) => {
          const nativeInput = composing
            ? null
            : encodeTerminalNativeKey(event, runtime.provider);
          if (nativeInput !== null) {
            clearInterruptGuard();
            event.preventDefault();
            event.stopPropagation();
            writeRuntimeInput(nativeInput, { observeExitIntent: false });
            return false;
          }
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
              event.preventDefault();
              event.stopPropagation();
              clearInterruptGuard();
              requestTermination();
              return false;
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

          pasteClipboardText();
          return false;
        });
        fitAddon.fit();

        const input = terminal.onData((data) => {
          writeRuntimeInput(data);
        });
        const resize = terminal.onResize(({ cols, rows }) => {
          if (!acceptingInputRef.current) return;
          void window.lumora.resizeRuntime({ runtimeId: runtime.id, cols, rows }).catch(() => undefined);
        });
        let attached = false;
        let outputSequence = 0;
        let pendingOutput: Extract<RuntimeEvent, { type: 'output' }>[] = [];
        const writeOutput = (
          event: Extract<RuntimeEvent, { type: 'output' }>
        ) => {
          if (event.sequence <= outputSequence) return;
          outputSequence = event.sequence;
          writeTerminalOutput(event.data);
        };
        const unsubscribe = window.lumora.onRuntimeEvent((event) => {
          if (event.runtimeId !== runtime.id) return;
          if (event.type === 'output') {
            if (attached) writeOutput(event);
            else pendingOutput.push(event);
          } else {
            if (!isRuntimeLive(event.runtime)) {
              observedRuntimeEnded = true;
              acceptingInputRef.current = false;
              clearExitFallback();
              exitIntent.reset();
            }
            onRuntimeChange(event.runtime);
          }
        });
        const observer =
          typeof ResizeObserver === 'undefined'
            ? null
            : new ResizeObserver(() => fitAddon.fit());
        observer?.observe(target);
        dispose = () => {
          if (outputFlushTimer !== null) {
            window.clearTimeout(outputFlushTimer);
            outputFlushTimer = null;
          }
          clearExitFallback();
          exitIntent.reset();
          deferredOutput = [];
          target.removeEventListener('contextmenu', contextMenu);
          terminal.textarea?.removeEventListener(
            'compositionstart',
            compositionStart
          );
          terminal.textarea?.removeEventListener(
            'compositionend',
            compositionEnd
          );
          terminal.textarea?.removeEventListener('blur', compositionBlur);
          observer?.disconnect();
          unsubscribe();
          input.dispose();
          resize.dispose();
          terminal.dispose();
        };

        void window.lumora.attachRuntime(runtime.id).then(
          (attachment) => {
            if (!alive) return;
            if (attachment.snapshot.length > 0) {
              writeTerminalOutput(attachment.snapshot);
            }
            outputSequence = attachment.outputSequence;
            attached = true;
            pendingOutput
              .sort((left, right) => left.sequence - right.sequence)
              .forEach(writeOutput);
            if (!isRuntimeLive(attachment.runtime)) {
              observedRuntimeEnded = true;
              acceptingInputRef.current = false;
              clearExitFallback();
              exitIntent.reset();
            }
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
    const terminal = terminalRef.current;
    if (terminal !== null) {
      terminal.options.theme = terminalPalette(theme, backgroundOpacity);
    }
  }, [backgroundOpacity, theme]);

  useEffect(() => {
    if (!isRuntimeLive(runtime)) {
      acceptingInputRef.current = false;
    }
  }, [runtime]);

  useEffect(() => {
    if (!active) {
      clearInterruptGuard();
      return;
    }
    fitAddonRef.current?.fit();
    terminalRef.current?.focus();
  }, [active, clearInterruptGuard, focusRequestKey]);

  return (
    <div className={`managed-terminal-shell managed-terminal-shell-${theme}`}>
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
