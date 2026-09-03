import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  DirectSessionLaunchState
} from './useDirectSessionLaunch';
import { renderWithLocalization } from '../test/render-with-localization';
import { DirectSessionLaunchWorkspace } from './DirectSessionLaunchWorkspace';

const launch = {
  id: 1,
  phase: 'preparing',
  preview: null,
  session: {
    id: 'session-1',
    provider: 'codex',
    title: 'Review Lumora'
  },
  workspace: {
    id: 'workspace-1',
    displayName: 'Lumora'
  }
} as DirectSessionLaunchState;

describe('DirectSessionLaunchWorkspace', () => {
  it('renders launch progress inside the standard Lumora chat layout', () => {
    renderWithLocalization(
      <DirectSessionLaunchWorkspace
        launch={launch}
        onClose={vi.fn()}
        onOpenOptions={vi.fn()}
        onRetry={vi.fn()}
        onTrustAndContinue={vi.fn()}
      />
    );

    const workspace = screen.getByRole('region', {
      name: 'Starting Review Lumora'
    });
    const header = workspace.querySelector('header');
    const body = workspace.querySelector('.direct-session-launch-body');
    const message = workspace.querySelector('.direct-session-launch-state');

    expect(header).toHaveClass('terminal-header', 'structured-agent-header');
    expect(body).toHaveClass('structured-agent-body');
    expect(body).toContainElement(
      workspace.querySelector('.structured-conversation')
    );
    expect(message).toHaveClass(
      'structured-message',
      'structured-message-assistant'
    );
    expect(screen.getByText('Codex')).toBeInTheDocument();
    expect(screen.getByText('Preparing the session')).toBeInTheDocument();
    expect(screen.getByText(/validating the saved session and Lumora/))
      .toBeInTheDocument();
  });

  it('offers the recovery actions as standard Lumora buttons', () => {
    renderWithLocalization(
      <DirectSessionLaunchWorkspace
        launch={{ ...launch, phase: 'error' }}
        onClose={vi.fn()}
        onOpenOptions={vi.fn()}
        onRetry={vi.fn()}
        onTrustAndContinue={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Try again' }))
      .toHaveClass('refresh-button');
    expect(screen.getByRole('button', { name: /Resume options/ }))
      .toHaveClass('secondary-button');
  });

  it('offers the trust action as a standard Lumora button', () => {
    renderWithLocalization(
      <DirectSessionLaunchWorkspace
        launch={{ ...launch, phase: 'awaiting-trust' }}
        onClose={vi.fn()}
        onOpenOptions={vi.fn()}
        onRetry={vi.fn()}
        onTrustAndContinue={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Trust and continue' }))
      .toHaveClass('refresh-button');
  });

  it('renders the provider name in the starting phase instead of a locale key', () => {
    renderWithLocalization(
      <DirectSessionLaunchWorkspace
        launch={{ ...launch, phase: 'starting' }}
        onClose={vi.fn()}
        onOpenOptions={vi.fn()}
        onRetry={vi.fn()}
        onTrustAndContinue={vi.fn()}
      />
    );

    expect(screen.getByText('Starting Codex')).toBeInTheDocument();
    expect(screen.queryByText('TERMINAL.DIRECT.STARTING-TITLE'))
      .not.toBeInTheDocument();
  });
});
