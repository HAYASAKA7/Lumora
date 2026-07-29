import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  SessionImportInspection,
  SessionImportPlan,
  SessionTransferArchiveSelection,
  SessionTransferProgressEvent,
  SessionTransferResult,
  WorkspaceSummary
} from '../../../shared/contracts';
import { SessionTransferDialog } from './SessionTransferDialog';

const WORKSPACE_ID = 'a'.repeat(64);
const SESSION_ID = 'b'.repeat(64);
const OPERATION_ID = '0198f8b6-18f3-7ca0-9f0f-123456789abc';

const selection: SessionTransferArchiveSelection = {
  selectionToken: '0198f8b6-18f3-7ca0-9f0f-abcdefabcdef',
  fileName: 'lumora-sessions.zip',
  encrypted: false
};

const workspace: WorkspaceSummary = {
  id: WORKSPACE_ID,
  displayName: 'Lumora',
  canonicalPath: 'D:\\Projects\\AI\\Lumora',
  available: true,
  origin: 'manual',
  sessionCount: 0,
  providerCounts: {},
  lastActivityAt: null
};

const inspection: SessionImportInspection = {
  inspectionToken: '0198f8b6-18f3-7ca0-9f0f-fedcbafedcba',
  archiveName: selection.fileName,
  encrypted: false,
  sourcePlatform: 'win32',
  providers: [
    {
      provider: 'codex',
      displayName: 'Codex',
      sessionCount: 2,
      support: 'supported',
      installGuidance: null
    },
    {
      provider: 'claude',
      displayName: 'Claude Code',
      sessionCount: 1,
      support: 'provider_not_installed',
      installGuidance: 'Install Claude Code first.'
    }
  ],
  workspaces: [
    {
      sourceWorkspaceKey: 'source-lumora',
      displayName: 'Lumora',
      originalPath: '/Users/test/Lumora',
      sessionCount: 2,
      suggestedWorkspaceId: WORKSPACE_ID,
      confidence: 'high'
    }
  ],
  sessionCount: 3,
  expiresAt: '2026-07-29T13:00:00.000Z'
};

const plan: SessionImportPlan = {
  planToken: '0198f8b6-18f3-7ca0-9f0f-111111111111',
  ready: [
    {
      sessionId: SESSION_ID,
      nativeSessionId: 'codex-session',
      provider: 'codex',
      title: 'Transfer design',
      workspaceId: WORKSPACE_ID,
      estimatedBytes: 512
    }
  ],
  skipped: [],
  providers: ['codex'],
  expiresAt: '2026-07-29T13:00:00.000Z'
};

const result: SessionTransferResult = {
  operationId: OPERATION_ID,
  direction: 'import',
  completedAt: '2026-07-29T12:00:00.000Z',
  status: 'completed',
  importedCount: 1,
  exportedCount: 0,
  skippedCount: 0,
  failedCount: 0,
  providers: ['codex'],
  items: []
};

function installApi(overrides: Record<string, unknown> = {}): void {
  Object.defineProperty(window, 'lumora', {
    configurable: true,
    value: {
      inspectSessionImport: vi.fn().mockResolvedValue(inspection),
      planSessionImport: vi.fn().mockResolvedValue(plan),
      executeSessionImport: vi.fn().mockResolvedValue(result),
      chooseTransferWorkspace: vi.fn().mockResolvedValue(null),
      cancelTransferOperation: vi.fn().mockResolvedValue(undefined),
      onTransferEvent: vi.fn(
        (_listener: (event: SessionTransferProgressEvent) => void) =>
          () => undefined
      ),
      ...overrides
    }
  });
}

describe('SessionTransferDialog', () => {
  beforeEach(() => installApi());

  it('keeps one stable, fixed workflow shell while steps change', async () => {
    render(
      <SessionTransferDialog
        onClose={vi.fn()}
        onImported={vi.fn()}
        selection={selection}
        workspaces={[workspace]}
      />
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('session-transfer-dialog');
    expect(dialog).toHaveStyle({ '--transfer-dialog-size': 'medium' });

    fireEvent.click(screen.getByRole('button', { name: 'Review archive' }));
    await screen.findByRole('heading', { name: 'Choose providers' });

    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(screen.getByText('Codex · 2 ready')).toBeInTheDocument();
    expect(screen.getByText('Claude Code · Install provider first')).toBeInTheDocument();
  });

  it('plans and imports supported sessions without selecting a missing provider', async () => {
    const onImported = vi.fn().mockResolvedValue(undefined);
    render(
      <SessionTransferDialog
        onClose={vi.fn()}
        onImported={onImported}
        selection={selection}
        workspaces={[workspace]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Review archive' }));
    await screen.findByRole('heading', { name: 'Choose providers' });
    expect(screen.getByRole('checkbox', { name: /Claude Code/ })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(
      await screen.findByRole('heading', { name: 'Map workspaces' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review import' }));

    expect(
      await screen.findByRole('heading', { name: 'Review import' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 session' }));

    await screen.findByRole('heading', { name: 'Import complete' });
    expect(window.lumora.planSessionImport).toHaveBeenCalledWith({
      inspectionToken: inspection.inspectionToken,
      providers: ['codex'],
      workspaceMappings: [
        {
          sourceWorkspaceKey: 'source-lumora',
          action: 'map',
          destinationWorkspaceId: WORKSPACE_ID
        }
      ]
    });
    expect(window.lumora.executeSessionImport).toHaveBeenCalledWith({
      planToken: plan.planToken
    });
    expect(onImported).toHaveBeenCalledOnce();
  });

  it('clears an archive password immediately when inspection fails', async () => {
    installApi({
      inspectSessionImport: vi.fn().mockRejectedValue(new Error('No access'))
    });
    render(
      <SessionTransferDialog
        onClose={vi.fn()}
        onImported={vi.fn()}
        selection={{ ...selection, encrypted: true }}
        workspaces={[workspace]}
      />
    );

    const password = screen.getByLabelText('Archive password');
    fireEvent.change(password, { target: { value: 'secret-value' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock archive' }));

    await waitFor(() => expect(password).toHaveValue(''));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The archive could not be inspected.'
    );
  });
});
