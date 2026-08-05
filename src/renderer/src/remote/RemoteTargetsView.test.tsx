import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { LumoraApi } from '../../../shared/contracts';
import { RemoteTargetsView } from './RemoteTargetsView';

const TARGET_ID = '499eb042-41e3-4199-be55-c8689dc342a5';
const fingerprint = 'SHA256:57qsnZ7C9rC8S3dftMDSqdHcpZ+PZfNclRBfXZXp0mM';
const summary = {
  target: {
    id: TARGET_ID,
    kind: 'remote',
    displayName: 'Build server',
    platform: 'unknown',
    architecture: 'unknown',
    connectionState: 'offline',
    helperVersion: null,
    protocolVersion: null,
    capabilities: [],
    lastConnectedAt: null,
    lastScannedAt: null
  },
  profile: {
    executionTargetId: TARGET_ID,
    displayName: 'Build server',
    route: 'direct',
    host: 'build.internal',
    port: 22,
    username: 'builder',
    sshConfigHost: null,
    authentication: { method: 'agent' },
    verifiedHostFingerprint: null,
    createdAt: '2026-08-04T09:00:00.000Z',
    updatedAt: '2026-08-04T09:00:00.000Z'
  }
} as const;

describe('RemoteTargetsView', () => {
  it('creates a direct SSH profile without requesting or persisting a secret', async () => {
    const api = {
      listRemoteTargets: vi.fn().mockResolvedValue([]),
      createRemoteTarget: vi.fn().mockResolvedValue(summary)
    } as unknown as LumoraApi;
    render(<RemoteTargetsView api={api} />);

    const addRemote = await screen.findByRole('button', {
      name: 'Add remote computer'
    });
    expect(addRemote).toHaveClass('refresh-button');
    fireEvent.click(addRemote);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Build server' } });
    fireEvent.change(screen.getByLabelText('Host'), { target: { value: 'build.internal' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'builder' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save remote computer' }));

    await waitFor(() => expect(api.createRemoteTarget).toHaveBeenCalledWith({
      displayName: 'Build server',
      route: 'direct',
      host: 'build.internal',
      port: 22,
      username: 'builder',
      authentication: { method: 'agent' }
    }));
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it('uses Lumora-owned option menus for remote profile choices', async () => {
    const api = {
      listRemoteTargets: vi.fn().mockResolvedValue([])
    } as unknown as LumoraApi;
    render(<RemoteTargetsView api={api} />);

    fireEvent.click(await screen.findByRole('button', {
      name: 'Add remote computer'
    }));
    const dialog = screen.getByRole('dialog', {
      name: 'Remote computer profile'
    });
    expect(dialog).toHaveClass('new-session-dialog');
    expect(dialog.parentElement).toHaveClass('dialog-backdrop');
    expect(within(dialog).getByTestId('remote-profile-dialog-body')).toHaveClass('dialog-body');


    const route = screen.getByRole('button', { name: 'Connection route' });
    expect(route).toHaveClass('select-menu-trigger');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    fireEvent.click(route);

    const options = screen.getByRole('listbox', {
      name: 'Connection route options'
    });
    expect(options).toHaveClass('select-menu-options');
    fireEvent.click(within(options).getByRole('option', {
      name: 'OpenSSH config alias'
    }));

    expect(screen.getByLabelText('SSH config alias')).toBeInTheDocument();
  });

  it('requires explicit fingerprint trust before opening the remote window', async () => {
    const trusted = {
      ...summary,
      profile: { ...summary.profile, verifiedHostFingerprint: fingerprint }
    };
    const api = {
      listRemoteTargets: vi.fn().mockResolvedValue([summary]),
      observeRemoteHost: vi.fn().mockResolvedValue({
        executionTargetId: TARGET_ID, fingerprint
      }),
      trustRemoteHost: vi.fn().mockResolvedValue(trusted),
      openRemoteTargetWindow: vi.fn().mockResolvedValue(undefined)
    } as unknown as LumoraApi;
    render(<RemoteTargetsView api={api} />);

    const verifyIdentity = await screen.findByRole('button', {
      name: 'Verify identity'
    });
    expect(verifyIdentity).toHaveClass('refresh-button');
    fireEvent.click(verifyIdentity);
    expect(await screen.findByText(fingerprint)).toBeInTheDocument();
    const trustFingerprint = screen.getByRole('button', {
      name: 'Trust this fingerprint'
    });
    expect(trustFingerprint).toHaveClass('refresh-button');
    fireEvent.click(trustFingerprint);
    const openRemote = await screen.findByRole('button', {
      name: 'Open remote Lumora'
    });
    expect(openRemote).toHaveClass('refresh-button');
    fireEvent.click(openRemote);

    expect(api.trustRemoteHost).toHaveBeenCalledWith({
      executionTargetId: TARGET_ID, fingerprint
    });
    expect(api.openRemoteTargetWindow).toHaveBeenCalledWith(TARGET_ID);
  });
});
