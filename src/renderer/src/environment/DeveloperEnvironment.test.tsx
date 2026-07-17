import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { DeveloperEnvironmentScanResult } from '../../../shared/contracts';
import {
  DeveloperEnvironmentNotice,
  DeveloperEnvironmentPanel
} from './DeveloperEnvironment';

const healthy: DeveloperEnvironmentScanResult = {
  checkedAt: '2026-07-17T01:00:00.000Z',
  node: {
    state: 'ready',
    executablePath: 'C:\\Program Files\\nodejs\\node.EXE',
    version: 'v24.18.0'
  },
  npm: {
    state: 'ready',
    executablePath: 'C:\\Program Files\\nodejs\\npm.CMD',
    version: '11.6.2'
  }
};

describe('DeveloperEnvironmentNotice', () => {
  it('stays out of the way when both tools are ready', () => {
    const { container } = render(
      <DeveloperEnvironmentNotice
        onOpenNodeDownload={vi.fn()}
        status={{ state: 'ready', scan: healthy }}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('names missing tools and reports browser-open failures inline', async () => {
    const onOpenNodeDownload = vi
      .fn()
      .mockRejectedValue(new Error('browser blocked'));
    render(
      <DeveloperEnvironmentNotice
        onOpenNodeDownload={onOpenNodeDownload}
        status={{
          state: 'ready',
          scan: {
            ...healthy,
            node: { state: 'not_found', executablePath: null, version: null },
            npm: { state: 'not_found', executablePath: null, version: null }
          }
        }}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Node.js and npm were not found'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Download Node.js' }));
    await waitFor(() => expect(onOpenNodeDownload).toHaveBeenCalledOnce());
    expect(
      await screen.findByText('The Node.js download page could not be opened.')
    ).toBeInTheDocument();
  });

  it('distinguishes an unverifiable tool from a missing one', () => {
    render(
      <DeveloperEnvironmentNotice
        onOpenNodeDownload={vi.fn()}
        status={{
          state: 'ready',
          scan: {
            ...healthy,
            npm: {
              state: 'probe_failed',
              executablePath: '/usr/local/bin/npm',
              version: null
            }
          }
        }}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'npm was found, but its version could not be verified'
    );
  });

  it('does not claim tools are missing when the scan fails', () => {
    render(
      <DeveloperEnvironmentNotice
        onOpenNodeDownload={vi.fn()}
        status={{ state: 'error' }}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Developer tool check is unavailable'
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('DeveloperEnvironmentPanel', () => {
  it('shows detected versions, executable paths, and check time', () => {
    render(
      <DeveloperEnvironmentPanel
        onOpenNodeDownload={vi.fn()}
        status={{ state: 'ready', scan: healthy }}
      />
    );

    expect(screen.getByRole('heading', { name: 'Developer tools' })).toBeInTheDocument();
    expect(screen.getAllByText('Detected')).toHaveLength(2);
    expect(screen.getByText('v24.18.0')).toBeInTheDocument();
    expect(screen.getByText('11.6.2')).toBeInTheDocument();
    expect(screen.getByText('C:\\Program Files\\nodejs\\node.EXE')).toBeInTheDocument();
    expect(screen.getByText('C:\\Program Files\\nodejs\\npm.CMD')).toBeInTheDocument();
    expect(screen.getByText(/Last checked/)).toBeInTheDocument();
  });

  it('shows truthful missing and probe-failed recovery details', () => {
    render(
      <DeveloperEnvironmentPanel
        onOpenNodeDownload={vi.fn().mockResolvedValue(undefined)}
        status={{
          state: 'ready',
          scan: {
            ...healthy,
            node: { state: 'not_found', executablePath: null, version: null },
            npm: {
              state: 'probe_failed',
              executablePath: '/usr/local/bin/npm',
              version: null
            }
          }
        }}
      />
    );

    expect(screen.getByText('Not found')).toBeInTheDocument();
    expect(screen.getByText('Version check failed')).toBeInTheDocument();
    expect(screen.getByText('Install Node.js, then refresh.')).toBeInTheDocument();
    expect(
      screen.getByText('Run npm --version in a terminal, then refresh.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download Node.js' })).toBeInTheDocument();
  });

  it('renders independent loading and error states', () => {
    const { rerender } = render(
      <DeveloperEnvironmentPanel
        onOpenNodeDownload={vi.fn()}
        status={{ state: 'loading' }}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Checking Node.js and npm'
    );

    rerender(
      <DeveloperEnvironmentPanel
        onOpenNodeDownload={vi.fn()}
        status={{ state: 'error' }}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Developer tool details are unavailable'
    );
  });
});
