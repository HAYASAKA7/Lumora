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
  const storage = {
    selectedJournalDirectory: null,
    effectiveJournalDirectory: 'C:\\Lumora\\diagnostics',
    selectedExportDirectory: 'D:\\Support bundles',
    effectiveExportDirectory: 'D:\\Support bundles',
    journalUsesDefault: true,
    exportUsesDefault: false,
    restartRequired: false,
    fallbackActive: false
  } as const;
  return {
    getDiagnosticSummary: vi.fn().mockResolvedValue(summary),
    exportDiagnosticBundle: vi.fn().mockResolvedValue({ status: 'saved' }),
    getDiagnosticStorageSettings: vi.fn().mockResolvedValue(storage),
    chooseDiagnosticJournalDirectory: vi.fn().mockResolvedValue({
      ...storage,
      selectedJournalDirectory: 'E:\\Lumora journal',
      journalUsesDefault: false,
      restartRequired: true
    }),
    resetDiagnosticJournalDirectory: vi.fn().mockResolvedValue(storage),
    chooseDiagnosticExportDirectory: vi.fn().mockResolvedValue({
      ...storage,
      selectedExportDirectory: 'E:\\Exports',
      effectiveExportDirectory: 'E:\\Exports'
    }),
    resetDiagnosticExportDirectory: vi.fn().mockResolvedValue({
      ...storage,
      selectedExportDirectory: null,
      effectiveExportDirectory: 'C:\\Documents',
      exportUsesDefault: true
    })
  } satisfies Pick<
    LumoraApi,
    | 'getDiagnosticSummary'
    | 'exportDiagnosticBundle'
    | 'getDiagnosticStorageSettings'
    | 'chooseDiagnosticJournalDirectory'
    | 'resetDiagnosticJournalDirectory'
    | 'chooseDiagnosticExportDirectory'
    | 'resetDiagnosticExportDirectory'
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

    expect(screen.getByRole('button', { name: 'Export diagnostics' })).toHaveClass(
      'refresh-button'
    );

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

  it('configures journal and export folders with restart guidance', async () => {
    const api = createApi();
    render(<DiagnosticsPanel active api={api} />);

    expect(await screen.findByText('C:\\Lumora\\diagnostics')).toBeVisible();
    expect(screen.getByText('D:\\Support bundles')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Choose journal folder' }));
    expect(await screen.findByText('E:\\Lumora journal')).toBeVisible();
    expect(screen.getByText(/restart Lumora to use this journal folder/i)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Choose export folder' }));
    expect(await screen.findByText('E:\\Exports')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Use Documents for exports' }));
    expect(await screen.findByText('C:\\Documents')).toBeVisible();
  });

  it('shows a safe fallback notice without exposing an operation error', async () => {
    const api = createApi();
    api.getDiagnosticStorageSettings.mockResolvedValueOnce({
      ...await api.getDiagnosticStorageSettings(),
      fallbackActive: true,
      restartRequired: true
    });
    api.chooseDiagnosticJournalDirectory.mockRejectedValueOnce(
      new Error('E:\\private\\unavailable')
    );
    render(<DiagnosticsPanel active api={api} />);

    expect(await screen.findByText(/default journal folder for this run/i)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Choose journal folder' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Lumora could not update the diagnostic storage location.'
    );
    expect(screen.queryByText(/private\\unavailable/i)).not.toBeInTheDocument();
  });
});
