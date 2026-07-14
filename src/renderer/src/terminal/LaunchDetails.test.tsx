import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { LaunchPreview } from '../../../shared/contracts';
import { LaunchDetails } from './LaunchDetails';

const preview: LaunchPreview = {
  launchToken: '0198f8b6-18f3-7ca0-9f0f-123456789abc',
  launchHash: 'c'.repeat(64),
  strategy: 'new',
  sessionId: null,
  provider: 'codex',
  executablePath: 'C:\\tools\\codex.exe',
  args: ['--search'],
  command: 'codexp',
  workingDirectory: 'D:\\Projects\\Lumora',
  workspaceTrusted: true,
  environmentNames: ['PATH', 'SHELL'],
  terminalProfile: {
    id: 'b'.repeat(64),
    kind: 'detected',
    name: 'PowerShell 7',
    shellFamily: 'pwsh',
    executablePath: 'C:\\tools\\pwsh.exe',
    args: [],
    available: true,
    recommended: true
  },
  configuration: [
    {
      field: 'providerCommand',
      value: 'codexp',
      winningSource: { scope: 'provider', targetId: 'codex' },
      shadowed: [],
      mergeStrategy: 'replace',
      warnings: [],
      sensitive: false
    }
  ],
  warnings: [],
  createdAt: '2026-07-14T08:00:00.000Z',
  expiresAt: '2026-07-14T08:05:00.000Z'
};

describe('LaunchDetails', () => {
  it('keeps resolved launch diagnostics in a closed disclosure', () => {
    render(<LaunchDetails preview={preview} />);

    const summary = screen.getByText('Launch details');
    const details = summary.closest('details');
    expect(details).not.toBeNull();
    if (details === null) throw new Error('Launch details disclosure missing');
    expect(details).not.toHaveAttribute('open');
    expect(within(details).getByText('codexp')).toBeInTheDocument();
    expect(within(details).getByText(preview.executablePath)).toBeInTheDocument();
    expect(within(details).getByText('--search')).toBeInTheDocument();
    expect(within(details).getByText(preview.workingDirectory)).toBeInTheDocument();
    expect(within(details).getByText('PATH, SHELL')).toBeInTheDocument();
  });
});
