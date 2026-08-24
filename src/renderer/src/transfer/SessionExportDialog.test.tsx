import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  SessionExportPlan,
  SessionTransferProgressEvent,
  SessionTransferResult
} from '../../../shared/contracts';
import { SessionExportDialog } from './SessionExportDialog';
import { renderWithLocalization } from '../test/render-with-localization';

const render = renderWithLocalization;

const SESSION_ID = 'a'.repeat(64);
const PLAN_TOKEN = '0198f8b6-18f3-7ca0-9f0f-123456789abc';
const OPERATION_ID = '0198f8b6-18f3-7ca0-9f0f-abcdefabcdef';

const plan: SessionExportPlan = {
  planToken: PLAN_TOKEN,
  sessions: [
    {
      sessionId: SESSION_ID,
      nativeSessionId: 'session-1',
      provider: 'opencode',
      title: 'Portable session',
      workspaceId: 'b'.repeat(64),
      estimatedBytes: 1_024
    }
  ],
  skipped: [],
  estimatedBytes: 1_024,
  expiresAt: '2026-07-29T13:00:00.000Z'
};

const result: SessionTransferResult = {
  operationId: OPERATION_ID,
  direction: 'export',
  completedAt: '2026-07-29T12:00:00.000Z',
  status: 'completed',
  importedCount: 0,
  exportedCount: 1,
  skippedCount: 0,
  failedCount: 0,
  providers: ['opencode'],
  items: []
};

function installApi(
  overrides: Record<string, unknown> = {}
): void {
  Object.defineProperty(window, 'lumora', {
    configurable: true,
    value: {
      prepareSessionExport: vi.fn().mockResolvedValue(plan),
      executeSessionExport: vi.fn().mockResolvedValue(result),
      cancelTransferOperation: vi.fn().mockResolvedValue(undefined),
      onTransferEvent: vi.fn(
        (_listener: (event: SessionTransferProgressEvent) => void) =>
          () => undefined
      ),
      ...overrides
    }
  });
}

describe('SessionExportDialog', () => {
  beforeEach(() => installApi());

  it('prepares authoritatively and exports encrypted by default', async () => {
    render(
      <SessionExportDialog onClose={vi.fn()} sessionIds={[SESSION_ID]} />
    );

    expect(await screen.findByText('1 ready to export')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Encrypt archive' })).toBeChecked();

    const password = screen.getByLabelText('Archive password');
    const confirmation = screen.getByLabelText('Confirm password');
    fireEvent.change(password, { target: { value: 'strong password' } });
    fireEvent.change(confirmation, { target: { value: 'different' } });
    expect(
      screen.getByRole('button', { name: 'Choose destination and export' })
    ).toBeDisabled();

    fireEvent.change(confirmation, { target: { value: 'strong password' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'Choose destination and export' })
    );

    await screen.findByRole('heading', { name: 'Export complete' });
    expect(window.lumora.executeSessionExport).toHaveBeenCalledWith({
      planToken: PLAN_TOKEN,
      protection: { encrypted: true, password: 'strong password' }
    });
    expect(screen.queryByLabelText('Archive password')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Confirm password')).not.toBeInTheDocument();
  });

  it('warns before an explicit unencrypted export and sends no password', async () => {
    render(
      <SessionExportDialog onClose={vi.fn()} sessionIds={[SESSION_ID]} />
    );
    await screen.findByText('1 ready to export');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Encrypt archive' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Anyone with this archive can read its session files.'
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Choose destination and export' })
    );

    await waitFor(() =>
      expect(window.lumora.executeSessionExport).toHaveBeenCalledWith({
        planToken: PLAN_TOKEN,
        protection: { encrypted: false }
      })
    );
  });

  it('shows native picker cancellation as a terminal result', async () => {
    installApi({
      executeSessionExport: vi.fn().mockResolvedValue(null)
    });
    render(
      <SessionExportDialog onClose={vi.fn()} sessionIds={[SESSION_ID]} />
    );
    await screen.findByText('1 ready to export');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Encrypt archive' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Choose destination and export' })
    );

    expect(
      await screen.findByRole('heading', { name: 'Export cancelled' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
  });
});
