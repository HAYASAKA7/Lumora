import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ProviderScanResult,
  SessionSummary,
  SessionTransferArchiveSelection
} from '../../../shared/contracts';
import { SessionTransferPanel } from './SessionTransferPanel';

vi.mock('./SessionTransferDialog', () => ({
  SessionTransferDialog: ({
    onImported,
    selection
  }: {
    onImported(): Promise<void> | void;
    selection: SessionTransferArchiveSelection;
  }) => (
    <div>
      <span>Importing {selection.fileName}</span>
      <button onClick={() => void onImported()} type="button">
        Complete import
      </button>
    </div>
  )
}));

vi.mock('./SessionExportDialog', () => ({
  SessionExportDialog: ({ sessionIds }: { sessionIds: readonly string[] }) => (
    <div>Exporting {sessionIds.join(',')}</div>
  )
}));

const session = {
  id: 'a'.repeat(64),
  nativeId: 'codex-native',
  provider: 'codex',
  workspaceId: 'b'.repeat(64),
  title: 'Portable Codex session',
  createdAt: '2026-07-29T10:00:00.000Z',
  updatedAt: '2026-07-29T12:00:00.000Z',
  lifetimeTokens: 12_450,
  lifecycle: 'saved',
  sourceFreshness: 'current'
} satisfies SessionSummary;

const providerScan = {
  scannedAt: '2026-07-29T12:00:00.000Z',
  providers: [
    {
      provider: 'codex',
      displayName: 'Codex',
      state: 'ready',
      executablePath: 'C:\\tools\\codex.exe',
      version: 'codex 1.0.0',
      issue: null
    }
  ]
} satisfies ProviderScanResult;

function installApi(): void {
  Object.defineProperty(window, 'lumora', {
    configurable: true,
    value: {
      getTransferCapabilities: vi.fn().mockResolvedValue([
        {
          provider: 'codex',
          displayName: 'Codex',
          exportSupport: 'supported',
          routes: [
            {
              sourcePlatform: 'win32',
              destinationPlatform: 'win32',
              support: 'supported'
            },
            {
              sourcePlatform: 'win32',
              destinationPlatform: 'linux',
              support: 'route_unverified'
            }
          ],
          installGuidance: null
        }
      ]),
      getTransferHistory: vi.fn().mockResolvedValue([
        {
          id: '0198f8b6-18f3-7ca0-9f0f-123456789abc',
          direction: 'import',
          completedAt: '2026-07-29T12:00:00.000Z',
          importedCount: 2,
          exportedCount: 0,
          skippedCount: 1,
          providers: ['codex']
        }
      ]),
      chooseSessionImportArchive: vi.fn().mockResolvedValue({
        selectionToken: '0198f8b6-18f3-7ca0-9f0f-abcdefabcdef',
        fileName: 'lumora-sessions.zip',
        encrypted: false
      })
    }
  });
}

describe('SessionTransferPanel', () => {
  beforeEach(() => installApi());

  it('does not scan transfer state until its settings tab is active', async () => {
    const { rerender } = render(
      <SessionTransferPanel
        active={false}
        onImportCompleted={vi.fn()}
        providerScan={providerScan}
        runningSessionIds={new Set<string>()}
        sessions={[]}
        workspaces={[]}
      />
    );

    expect(window.lumora.getTransferCapabilities).not.toHaveBeenCalled();
    rerender(
      <SessionTransferPanel
        active
        onImportCompleted={vi.fn()}
        providerScan={providerScan}
        runningSessionIds={new Set<string>()}
        sessions={[]}
        workspaces={[]}
      />
    );

    expect(await screen.findByText('Codex')).toBeInTheDocument();
    expect(screen.getByText('2 imported · 1 skipped')).toBeInTheDocument();
  });

  it('opens the native archive picker and refreshes after a completed import', async () => {
    const onImportCompleted = vi.fn().mockResolvedValue(undefined);
    render(
      <SessionTransferPanel
        active
        onImportCompleted={onImportCompleted}
        providerScan={providerScan}
        runningSessionIds={new Set<string>()}
        sessions={[]}
        workspaces={[]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Import sessions' }));
    expect(await screen.findByText('Importing lumora-sessions.zip')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Complete import' }));

    await waitFor(() => expect(onImportCompleted).toHaveBeenCalledOnce());
    expect(window.lumora.getTransferHistory).toHaveBeenCalledTimes(2);
  });
  it('owns the complete export entrance and selection workflow', async () => {
    render(
      <SessionTransferPanel
        active
        onImportCompleted={vi.fn()}
        providerScan={providerScan}
        runningSessionIds={new Set<string>()}
        sessions={[session]}
        workspaces={[]}
      />
    );

    await screen.findByText('Codex');
    fireEvent.click(screen.getByRole('button', { name: 'Export sessions' }));

    expect(
      screen.getByRole('heading', { name: 'Choose sessions to export' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Continue with 0 sessions' })
    ).toBeDisabled();

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Portable Codex session' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue with 1 session' })
    );

    expect(screen.getByText(`Exporting ${session.id}`)).toBeInTheDocument();
  });

  it('labels development-only routes as experimental and allows their sessions', async () => {
    vi.mocked(window.lumora.getTransferCapabilities).mockResolvedValue([
      {
        provider: 'codex',
        displayName: 'Codex',
        exportSupport: 'experimental',
        routes: [
          {
            sourcePlatform: 'win32',
            destinationPlatform: 'win32',
            support: 'experimental'
          }
        ],
        installGuidance: null
      }
    ]);
    render(
      <SessionTransferPanel
        active
        onImportCompleted={vi.fn()}
        providerScan={providerScan}
        runningSessionIds={new Set<string>()}
        sessions={[session]}
        workspaces={[]}
      />
    );

    expect(await screen.findAllByText('Experimental')).not.toHaveLength(0);
    expect(
      screen.getByText(/development build enables adapter-backed routes/i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Export sessions' }));
    expect(
      screen.getByRole('checkbox', { name: 'Portable Codex session' })
    ).toBeEnabled();
  });
});
