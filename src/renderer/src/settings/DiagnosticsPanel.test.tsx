import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  DiagnosticProcessDetails,
  DiagnosticResources,
  DiagnosticSummary,
  LumoraApi
} from '../../../shared/contracts';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { renderWithLocalization } from '../test/render-with-localization';

const render = renderWithLocalization;

const styles = readFileSync(
  join(process.cwd(), 'src', 'renderer', 'src', 'styles.css'),
  'utf8'
);

const resources: DiagnosticResources = {
  sampledAt: '2026-08-13T08:00:00.000Z',
  lumora: {
    processCount: 3,
    workingSetBytes: 2 * 1024 * 1024,
    cpuPercent: 4.25
  },
  agents: { activeCount: 1 }
};

function withCpu(cpuPercent: number | null): DiagnosticResources {
  return { ...resources, lumora: { ...resources.lumora, cpuPercent } };
}

function metric(label: string) {
  return screen.getByText(label).nextElementSibling;
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

const processDetails: DiagnosticProcessDetails = {
  sampledAt: '2026-08-13T08:00:00.000Z',
  processTreeAvailable: true,
  truncated: false,
  lumora: [
    { pid: 100, depth: 0, kind: 'main', name: 'Browser', workingSetBytes: 200 * 1024 * 1024, cpuPercent: 1.5 },
    { pid: 102, depth: 1, kind: 'utility', name: 'Network Service', workingSetBytes: 30 * 1024 * 1024, cpuPercent: 0 },
    { pid: 110, depth: 1, kind: 'process', name: 'lumora-helper.exe', workingSetBytes: 8 * 1024 * 1024, cpuPercent: null }
  ],
  agents: [
    {
      id: 'connection-1', provider: 'codex', surface: 'unified', title: 'Fix the build', status: 'measured',
      processes: [
        { pid: 200, depth: 0, kind: 'process', name: 'cmd.exe', workingSetBytes: 4 * 1024 * 1024, cpuPercent: 0 },
        { pid: 202, depth: 1, kind: 'process', name: 'codex.exe', workingSetBytes: 300 * 1024 * 1024, cpuPercent: 12.5 }
      ]
    },
    { id: 'runtime-1', provider: 'claude', surface: 'terminal', title: 'Refactor settings', status: 'starting', processes: [] }
  ]
};

const summary: DiagnosticSummary = {
  generatedAt: '2026-08-13T08:00:00.000Z',
  previousRunAbnormal: true,
  journal: { storedEvents: 4, invalidRecords: 1 },
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
    getDiagnosticResources: vi.fn().mockResolvedValue(resources),
    getDiagnosticProcesses: vi.fn().mockResolvedValue(processDetails),
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
    | 'getDiagnosticResources'
    | 'getDiagnosticProcesses'
    | 'exportDiagnosticBundle'
    | 'getDiagnosticStorageSettings'
    | 'chooseDiagnosticJournalDirectory'
    | 'resetDiagnosticJournalDirectory'
    | 'chooseDiagnosticExportDirectory'
    | 'resetDiagnosticExportDirectory'
  >;
}

describe('DiagnosticsPanel', () => {
  afterEach(() => {
    setVisibility('visible');
  });

  it('uses Lumora typography for every diagnostic code and path value', () => {
    const rule = styles.match(/\.diagnostics-panel code\s*\{([^}]*)\}/)?.[1];

    expect(rule).toContain('font-family: inherit');
  });

  it('keeps the live details window and its columns a fixed size as figures change', () => {
    const dialog = styles.match(/\.diagnostics-details-dialog\s*\{([^}]*)\}/)?.[1];
    const table = styles.match(/\.diagnostics-process-table\s*\{([^}]*)\}/)?.[1];
    const summary = styles.match(/\.diagnostics-details-heading > \.diagnostics-details-summary\s*\{([^}]*)\}/)?.[1];

    expect(dialog).toMatch(/\bheight: min\(/);
    expect(dialog).toMatch(/\bwidth: min\(/);
    expect(table).toContain('table-layout: fixed');
    expect(summary).toContain('white-space: nowrap');
  });

  it('loads only when active and presents bounded process and event summaries', async () => {
    const api = createApi();
    const view = render(<DiagnosticsPanel active={false} api={api} />);

    expect(api.getDiagnosticSummary).not.toHaveBeenCalled();
    expect(api.getDiagnosticResources).not.toHaveBeenCalled();
    view.rerender(<DiagnosticsPanel active api={api} />);

    expect(await screen.findByText('Previous run ended unexpectedly')).toBeVisible();
    await screen.findByText('Lumora CPU');
    expect(metric('Cumulative working set')).toHaveTextContent('2.0 MB');
    expect(metric('Lumora CPU')).toHaveTextContent('4.3%');
    expect(metric('Lumora processes')).toHaveTextContent('3');
    expect(metric('Active agents')).toHaveTextContent('1');
    // The figures lead the page, ahead of the storage locations.
    const storage = await screen.findByRole('region', { name: 'Storage locations' });
    expect(
      screen.getByLabelText('Current local diagnostics').compareDocumentPosition(storage)
      & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.getByText('4 stored · 1 invalid ignored')).toBeVisible();
    expect(screen.getByText('renderer · process-gone')).toBeVisible();
    expect(screen.getByText('RENDERER_CRASHED')).toBeVisible();
  });

  it('keeps sampling resource use while Diagnostics is open, without reloading the journal', async () => {
    vi.useFakeTimers();
    const api = createApi();
    api.getDiagnosticResources
      .mockResolvedValueOnce(withCpu(null))
      .mockResolvedValueOnce(withCpu(4.25))
      .mockResolvedValueOnce(withCpu(2.5));
    const view = render(<DiagnosticsPanel active api={api} />);

    try {
      await flush();
      expect(metric('Lumora CPU')).toHaveTextContent('Measuring…');

      // Without a CPU reading the next sample comes sooner.
      await act(async () => {
        vi.advanceTimersByTime(1_000);
      });
      await flush();
      expect(metric('Lumora CPU')).toHaveTextContent('4.3%');

      await act(async () => {
        vi.advanceTimersByTime(1_999);
      });
      expect(api.getDiagnosticResources).toHaveBeenCalledTimes(2);
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      await flush();
      expect(metric('Lumora CPU')).toHaveTextContent('2.5%');
      expect(api.getDiagnosticResources).toHaveBeenCalledTimes(3);
      expect(api.getDiagnosticSummary).toHaveBeenCalledOnce();
    } finally {
      view.unmount();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('pauses sampling while the window is hidden and resumes when it is shown', async () => {
    vi.useFakeTimers();
    const api = createApi();
    const view = render(<DiagnosticsPanel active api={api} />);

    try {
      await flush();
      expect(api.getDiagnosticResources).toHaveBeenCalledOnce();

      setVisibility('hidden');
      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });
      expect(api.getDiagnosticResources).toHaveBeenCalledOnce();

      await act(async () => {
        setVisibility('visible');
      });
      await flush();
      expect(api.getDiagnosticResources).toHaveBeenCalledTimes(2);

      // Showing the window again does not start a second sampling loop.
      await act(async () => {
        setVisibility('visible');
        vi.advanceTimersByTime(2_000);
      });
      await flush();
      expect(api.getDiagnosticResources).toHaveBeenCalledTimes(3);
    } finally {
      view.unmount();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('stops sampling when Diagnostics becomes inactive and starts fresh on return', async () => {
    vi.useFakeTimers();
    const api = createApi();
    const view = render(<DiagnosticsPanel active api={api} />);

    try {
      await flush();

      view.rerender(<DiagnosticsPanel active={false} api={api} />);
      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });
      expect(api.getDiagnosticResources).toHaveBeenCalledOnce();
      expect(screen.queryByText('Lumora CPU')).toBeNull();

      api.getDiagnosticResources.mockResolvedValueOnce(withCpu(null));
      view.rerender(<DiagnosticsPanel active api={api} />);
      await flush();
      expect(api.getDiagnosticResources).toHaveBeenCalledTimes(2);
      expect(api.getDiagnosticSummary).toHaveBeenCalledTimes(2);
      expect(metric('Lumora CPU')).toHaveTextContent('Measuring…');
    } finally {
      view.unmount();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('says resource use is unavailable without exposing the failure, and keeps trying', async () => {
    vi.useFakeTimers();
    const api = createApi();
    api.getDiagnosticResources.mockRejectedValueOnce(new Error('C:\\secret'));
    const view = render(<DiagnosticsPanel active api={api} />);

    try {
      await flush();
      expect(screen.getByRole('alert')).toHaveTextContent('Resource use is temporarily unavailable.');
      expect(screen.queryByText(/secret/i)).not.toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(2_000);
      });
      await flush();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(metric('Cumulative working set')).toHaveTextContent('2.0 MB');
    } finally {
      view.unmount();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
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

  it('opens details listing every Lumora process and each agent\u2019s processes', async () => {
    const api = createApi();
    render(<DiagnosticsPanel active api={api} />);
    await screen.findByText('Lumora CPU');
    expect(api.getDiagnosticProcesses).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Process details' }));

    const dialog = await screen.findByRole('dialog', { name: 'Process details' });
    const lumora = await within(dialog).findByRole('table', { name: 'Lumora' });
    const lumoraRows = within(lumora).getAllByRole('row').slice(1).map((row) => row.textContent);
    expect(lumoraRows).toEqual([
      'Main process100200.0 MB1.5%',
      'Network Service10230.0 MB0.0%',
      'lumora-helper.exe1108.0 MB\u2014'
    ]);
    expect(within(dialog).getByText('238.0 MB \u00b7 1.5% CPU \u00b7 3 processes')).toBeVisible();

    const codex = within(dialog).getByRole('table', { name: 'Codex \u00b7 Fix the build' });
    expect(within(codex).getByRole('rowheader', { name: 'codex.exe' })).toHaveStyle({ '--process-depth': '1' });
    expect(within(dialog).getByText('304.0 MB \u00b7 12.5% CPU \u00b7 2 processes')).toBeVisible();
    expect(within(dialog).getByText('Unified UI')).toBeVisible();
    expect(within(dialog).getByText('Claude Code \u00b7 Refactor settings')).toBeVisible();
    expect(within(dialog).getByText('Native terminal')).toBeVisible();
    expect(within(dialog).getByText('Starting\u2026')).toBeVisible();
    expect(within(dialog).queryByText(/could not read the processes/i)).toBeNull();
  });

  it('keeps details live while open and stops reading processes once closed', async () => {
    vi.useFakeTimers();
    const api = createApi();
    const view = render(<DiagnosticsPanel active api={api} />);

    try {
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Process details' }));
      await flush();
      expect(api.getDiagnosticProcesses).toHaveBeenCalledOnce();

      // CPU is measured between samples, so the second comes sooner.
      await act(async () => {
        vi.advanceTimersByTime(1_000);
      });
      await flush();
      expect(api.getDiagnosticProcesses).toHaveBeenCalledTimes(2);
      await act(async () => {
        vi.advanceTimersByTime(2_000);
      });
      await flush();
      expect(api.getDiagnosticProcesses).toHaveBeenCalledTimes(3);

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('dialog', { name: 'Process details' })).toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });
      expect(api.getDiagnosticProcesses).toHaveBeenCalledTimes(3);
    } finally {
      view.unmount();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('closes details when Diagnostics is left', async () => {
    const api = createApi();
    const view = render(<DiagnosticsPanel active api={api} />);
    await screen.findByText('Lumora CPU');
    fireEvent.click(screen.getByRole('button', { name: 'Process details' }));
    await screen.findByRole('dialog', { name: 'Process details' });

    view.rerender(<DiagnosticsPanel active={false} api={api} />);

    expect(screen.queryByRole('dialog', { name: 'Process details' })).toBeNull();
  });

  it('says when only Lumora\u2019s own processes could be read, without exposing a failure', async () => {
    const api = createApi();
    api.getDiagnosticProcesses.mockResolvedValue({
      ...processDetails,
      processTreeAvailable: false,
      agents: [{ ...processDetails.agents[0]!, status: 'unavailable', processes: [] }]
    });
    render(<DiagnosticsPanel active api={api} />);
    await screen.findByText('Lumora CPU');
    fireEvent.click(screen.getByRole('button', { name: 'Process details' }));

    const dialog = await screen.findByRole('dialog', { name: 'Process details' });
    expect(await within(dialog).findByText(/could not read the processes it started/i)).toBeVisible();
    expect(within(dialog).getByText("This agent's processes could not be read.")).toBeVisible();

    api.getDiagnosticProcesses.mockRejectedValue(new Error('C:\\secret'));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Process details' }));
    const failed = await screen.findByRole('dialog', { name: 'Process details' });
    expect(await within(failed).findByRole('alert')).toHaveTextContent('Process details are temporarily unavailable.');
    expect(screen.queryByText(/secret/i)).toBeNull();
  });
});
