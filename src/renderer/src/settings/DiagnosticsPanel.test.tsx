import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { DiagnosticSummary, LumoraApi } from '../../../shared/contracts';
import { DiagnosticsPanel } from './DiagnosticsPanel';

const summary: DiagnosticSummary = {
  generatedAt: '2026-08-13T08:00:00.000Z',
  previousRunAbnormal: true,
  journal: { storedEvents: 4, invalidRecords: 1 },
  processes: {
    processCount: 3,
    workingSetBytes: 2 * 1024 * 1024,
    cpuPercent: 4.25
  },
  recentEvents: [
    {
      id: '00000000-0000-4000-8000-000000000001',
      recordedAt: '2026-08-13T07:59:00.000Z',
      severity: 'error',
      subsystem: 'renderer',
      operation: 'process-gone',
      outcome: 'failed',
      correlationId: '00000000-0000-4000-8000-000000000002',
      targetKind: 'local',
      code: 'RENDERER_CRASHED'
    }
  ]
};

function createApi() {
  return {
    getDiagnosticSummary: vi.fn().mockResolvedValue(summary),
    exportDiagnosticBundle: vi.fn().mockResolvedValue({ status: 'saved' })
  } satisfies Pick<
    LumoraApi,
    'getDiagnosticSummary' | 'exportDiagnosticBundle'
  >;
}

describe('DiagnosticsPanel', () => {
  it('loads only when active and presents bounded process and event summaries', async () => {
    const api = createApi();
    const view = render(<DiagnosticsPanel active={false} api={api} />);

    expect(api.getDiagnosticSummary).not.toHaveBeenCalled();
    view.rerender(<DiagnosticsPanel active api={api} />);

    expect(await screen.findByText('Previous run ended unexpectedly')).toBeVisible();
    expect(screen.getByText('2.0 MB')).toBeVisible();
    expect(screen.getByText('3')).toBeVisible();
    expect(screen.getByText('4.3%')).toBeVisible();
    expect(screen.getByText('renderer · process-gone')).toBeVisible();
    expect(screen.getByText('RENDERER_CRASHED')).toBeVisible();
  });

  it('refreshes and exports without exposing a filesystem path', async () => {
    const api = createApi();
    render(<DiagnosticsPanel active api={api} />);
    await screen.findByText('2.0 MB');

    fireEvent.click(screen.getByRole('button', { name: 'Refresh diagnostics' }));
    await waitFor(() => expect(api.getDiagnosticSummary).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('button', { name: 'Export diagnostics' }));
    expect(await screen.findByText('Diagnostics saved.')).toBeVisible();
    expect(api.exportDiagnosticBundle).toHaveBeenCalledOnce();
  });

  it('uses a generic recovery message when diagnostics cannot be loaded', async () => {
    const api = createApi();
    api.getDiagnosticSummary.mockRejectedValueOnce(new Error('C:\\secret'));
    render(<DiagnosticsPanel active api={api} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Diagnostics are temporarily unavailable.'
    );
    expect(screen.queryByText(/secret/i)).not.toBeInTheDocument();
  });
});
