import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  ProviderScanResult,
  SessionSummary,
  SessionTransferCapability
} from '../../../shared/contracts';
import { SessionTransferExportSelection } from './SessionTransferExportSelection';

const sessions: SessionSummary[] = [
  {
    id: 'a'.repeat(64),
    nativeId: 'codex-ready',
    provider: 'codex',
    workspaceId: 'd'.repeat(64),
    title: 'Ready Codex session',
    createdAt: '2026-07-29T09:00:00.000Z',
    updatedAt: '2026-07-29T12:00:00.000Z',
    lifetimeTokens: 12_450,
    lifecycle: 'saved',
    sourceFreshness: 'current'
  },
  {
    id: 'b'.repeat(64),
    nativeId: 'codex-running',
    provider: 'codex',
    workspaceId: 'd'.repeat(64),
    title: 'Running Codex session',
    createdAt: '2026-07-29T09:00:00.000Z',
    updatedAt: '2026-07-29T12:00:00.000Z',
    lifetimeTokens: null,
    lifecycle: 'saved',
    sourceFreshness: 'current'
  },
  {
    id: 'c'.repeat(64),
    nativeId: 'opencode-unverified',
    provider: 'opencode',
    workspaceId: 'd'.repeat(64),
    title: 'Unverified OpenCode session',
    createdAt: '2026-07-29T09:00:00.000Z',
    updatedAt: '2026-07-29T12:00:00.000Z',
    lifetimeTokens: null,
    lifecycle: 'saved',
    sourceFreshness: 'current'
  }
];

const capabilities: SessionTransferCapability[] = [
  {
    provider: 'codex',
    displayName: 'Codex',
    exportSupport: 'supported',
    routes: [],
    installGuidance: null
  },
  {
    provider: 'opencode',
    displayName: 'OpenCode',
    exportSupport: 'route_unverified',
    routes: [],
    installGuidance: null
  }
];

const providerScan: ProviderScanResult = {
  scannedAt: '2026-07-29T12:00:00.000Z',
  providers: [
    {
      provider: 'codex',
      displayName: 'Codex',
      state: 'ready',
      executablePath: 'C:\\tools\\codex.exe',
      version: 'codex 1.0.0',
      issue: null
    },
    {
      provider: 'opencode',
      displayName: 'OpenCode',
      state: 'ready',
      executablePath: 'C:\\tools\\opencode.exe',
      version: 'opencode 1.0.0',
      issue: null
    }
  ]
};

describe('SessionTransferExportSelection', () => {
  it('selects only eligible sessions and explains blocked routes', () => {
    const onContinue = vi.fn();
    render(
      <SessionTransferExportSelection
        capabilities={capabilities}
        onBack={vi.fn()}
        onContinue={onContinue}
        providerScan={providerScan}
        runningSessionIds={new Set([sessions[1]!.id])}
        sessions={sessions}
      />
    );

    expect(
      screen.getByRole('checkbox', { name: 'Running Codex session' })
    ).toBeDisabled();
    expect(
      screen.getByRole('checkbox', { name: 'Unverified OpenCode session' })
    ).toBeDisabled();
    expect(screen.getByText('This provider export route is not verified.'))
      .toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Select all Codex sessions' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue with 1 session' })
    );

    expect(onContinue).toHaveBeenCalledWith([sessions[0]!.id]);
  });

  it('filters providers without losing the current selection', () => {
    render(
      <SessionTransferExportSelection
        capabilities={capabilities}
        onBack={vi.fn()}
        onContinue={vi.fn()}
        providerScan={providerScan}
        runningSessionIds={new Set<string>()}
        sessions={sessions}
      />
    );

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Ready Codex session' })
    );
    fireEvent.click(screen.getByRole('button', {
      name: 'Filter export sessions by provider'
    }));
    fireEvent.click(screen.getByRole('option', { name: 'OpenCode' }));

    expect(
      screen.queryByRole('checkbox', { name: 'Ready Codex session' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Continue with 1 session' })
    ).toBeEnabled();
  });
});
