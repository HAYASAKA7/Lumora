import type { ReactNode } from 'react';

import type { DiagnosticEvent } from '../../../shared/contracts';
import { useLocalization } from '../localization/useLocalization';
import { DiagnosticsDialog } from './DiagnosticsDialog';
import { formatDuration, providerName } from './diagnostic-format';

function EventEntry({ event }: { event: DiagnosticEvent }) {
  const { formatDate, formatNumber, formatTime, t } = useLocalization();
  const recordedAt = new Date(event.recordedAt);
  const counts = Object.entries(event.counts ?? {})
    .flatMap(([name, value]) => value === undefined ? [] : [`${name} ${formatNumber(value)}`])
    .join(' · ');
  // An event records only the fields that apply to it.
  const fields = ([
    ['settings.diagnostics.events-field-outcome', event.outcome],
    ['settings.diagnostics.events-field-target', event.targetKind],
    ['settings.diagnostics.events-field-provider', event.provider === undefined ? null : providerName(event.provider)],
    ['settings.diagnostics.events-field-code', event.code === undefined ? null : <code>{event.code}</code>],
    ['settings.diagnostics.events-field-duration', event.durationMs === undefined ? null : formatDuration(event.durationMs, formatNumber)],
    ['settings.diagnostics.events-field-counts', counts === '' ? null : counts],
    ['settings.diagnostics.events-field-correlation', <code>{event.correlationId}</code>]
  ] satisfies Array<[string, ReactNode]>).filter(([, value]) => value !== null);

  return (
    <li className="diagnostics-event">
      <div className="diagnostics-event-heading">
        <span className={`diagnostics-event-severity is-${event.severity}`}>{event.severity}</span>
        <strong>{event.subsystem} · {event.operation}</strong>
        <time dateTime={event.recordedAt}>
          {formatDate(recordedAt)} {formatTime(recordedAt, { timeStyle: 'medium' })}
        </time>
      </div>
      <dl className="diagnostics-event-fields">
        {fields.map(([labelKey, value]) => (
          <div key={labelKey}>
            <dt>{t(labelKey)}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

/** Every event the summary holds, newest first, with each field it recorded. */
export function DiagnosticsEventsDialog({ events, onClose }: {
  events: readonly DiagnosticEvent[];
  onClose(): void;
}): ReactNode {
  const { t } = useLocalization();
  const newestFirst = [...events].reverse();

  return (
    <DiagnosticsDialog heading={t('settings.diagnostics.events-details-title')} onClose={onClose}>
      <p className="diagnostics-details-note">
        {t('settings.diagnostics.events-details-description', { count: events.length })}
      </p>
      <ol aria-label={t('settings.diagnostics.recent-events')} className="diagnostics-event-list">
        {newestFirst.map((event) => <EventEntry event={event} key={event.id} />)}
      </ol>
    </DiagnosticsDialog>
  );
}
