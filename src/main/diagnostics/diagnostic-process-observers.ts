import type { DiagnosticService } from './diagnostic-service';

type DiagnosticRecord = DiagnosticService['record'];
type Listener = (...args: unknown[]) => void;

interface EventHost {
  on(event: string, listener: Listener): unknown;
  off(event: string, listener: Listener): unknown;
}

interface InstallDiagnosticProcessObserversOptions {
  processHost: EventHost;
  appHost: EventHost;
  record: DiagnosticRecord;
}

const RENDERER_REASONS = new Set([
  'clean-exit',
  'abnormal-exit',
  'killed',
  'crashed',
  'oom',
  'launch-failed',
  'integrity-failure'
]);

const CHILD_REASONS = new Set([
  'clean-exit',
  'abnormal-exit',
  'killed',
  'crashed',
  'oom',
  'launch-failed',
  'integrity-failure'
]);

function reasonCode(prefix: 'RENDERER' | 'CHILD', value: unknown): string {
  const reason = typeof value === 'string' && (
    prefix === 'RENDERER' ? RENDERER_REASONS : CHILD_REASONS
  ).has(value)
    ? value
    : 'unknown';
  return `${prefix}_${reason.replaceAll('-', '_').toUpperCase()}`;
}

export function installDiagnosticProcessObservers({
  processHost,
  appHost,
  record
}: InstallDiagnosticProcessObserversOptions): () => void {
  const safelyRecord = (input: Parameters<DiagnosticRecord>[0]): void => {
    void record(input).catch(() => undefined);
  };
  const onUncaughtException: Listener = () => {
    safelyRecord({
      severity: 'error',
      subsystem: 'application',
      operation: 'uncaught-exception',
      outcome: 'failed',
      targetKind: 'local',
      code: 'UNCAUGHT_EXCEPTION'
    });
  };
  const onUnhandledRejection: Listener = () => {
    safelyRecord({
      severity: 'error',
      subsystem: 'application',
      operation: 'unhandled-rejection',
      outcome: 'failed',
      targetKind: 'local',
      code: 'UNHANDLED_REJECTION'
    });
  };
  const onRendererGone: Listener = (_event, _webContents, details) => {
    const reason = (details as { reason?: unknown } | undefined)?.reason;
    const clean = reason === 'clean-exit';
    safelyRecord({
      severity: clean ? 'info' : 'error',
      subsystem: 'renderer',
      operation: 'process-gone',
      outcome: clean ? 'succeeded' : 'failed',
      targetKind: 'local',
      code: reasonCode('RENDERER', reason)
    });
  };
  const onChildGone: Listener = (_event, details) => {
    const reason = (details as { reason?: unknown } | undefined)?.reason;
    const clean = reason === 'clean-exit';
    safelyRecord({
      severity: clean ? 'info' : 'error',
      subsystem: 'application',
      operation: 'child-process-gone',
      outcome: clean ? 'succeeded' : 'failed',
      targetKind: 'local',
      code: reasonCode('CHILD', reason)
    });
  };

  processHost.on('uncaughtExceptionMonitor', onUncaughtException);
  processHost.on('unhandledRejection', onUnhandledRejection);
  appHost.on('render-process-gone', onRendererGone);
  appHost.on('child-process-gone', onChildGone);

  return () => {
    processHost.off('uncaughtExceptionMonitor', onUncaughtException);
    processHost.off('unhandledRejection', onUnhandledRejection);
    appHost.off('render-process-gone', onRendererGone);
    appHost.off('child-process-gone', onChildGone);
  };
}
