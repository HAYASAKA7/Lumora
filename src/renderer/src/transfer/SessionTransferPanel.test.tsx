import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionTransferArchiveSelection } from '../../../shared/contracts';
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
        workspaces={[]}
      />
    );

    expect(window.lumora.getTransferCapabilities).not.toHaveBeenCalled();
    rerender(
      <SessionTransferPanel
        active
        onImportCompleted={vi.fn()}
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
        workspaces={[]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Import sessions' }));
    expect(await screen.findByText('Importing lumora-sessions.zip')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Complete import' }));

    await waitFor(() => expect(onImportCompleted).toHaveBeenCalledOnce());
    expect(window.lumora.getTransferHistory).toHaveBeenCalledTimes(2);
  });
});
