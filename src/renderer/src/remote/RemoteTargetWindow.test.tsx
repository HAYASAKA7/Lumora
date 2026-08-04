import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { LumoraApi } from '../../../shared/contracts';
import { RemoteTargetWindow } from './RemoteTargetWindow';

const TARGET_ID = '5377f5df-cc8c-42a3-bde1-b8764387b802';
const summary = {
  target: {
    id: TARGET_ID,
    kind: 'remote',
    displayName: 'Linux build server',
    platform: 'linux',
    architecture: 'x64',
    connectionState: 'offline',
    helperVersion: null,
    protocolVersion: null,
    capabilities: [],
    lastConnectedAt: null,
    lastScannedAt: null
  },
  profile: {
    executionTargetId: TARGET_ID,
    displayName: 'Linux build server',
    route: 'direct',
    host: 'linux.internal',
    port: 22,
    username: 'builder',
    sshConfigHost: null,
    authentication: { method: 'password' },
    verifiedHostFingerprint: 'SHA256:57qsnZ7C9rC8S3dftMDSqdHcpZ+PZfNclRBfXZXp0mM',
    createdAt: '2026-08-04T09:00:00.000Z',
    updatedAt: '2026-08-04T09:00:00.000Z'
  }
} as const;

describe('RemoteTargetWindow', () => {
  it('connects its bound target with an ephemeral password and exposes no local controls', async () => {
    const api = {
      listRemoteTargets: vi.fn().mockResolvedValue([summary]),
      connectRemoteTarget: vi.fn().mockResolvedValue({
        ...summary,
        target: { ...summary.target, connectionState: 'ready' },
        homeDirectory: '/home/builder',
        defaultShell: '/bin/bash'
      }),
      disconnectRemoteTarget: vi.fn()
    } as unknown as LumoraApi;

    render(<RemoteTargetWindow executionTargetId={TARGET_ID} api={api} />);
    expect(await screen.findByRole('heading', { name: 'Linux build server' }))
      .toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('SSH password'), {
      target: { value: 'memory-only' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => expect(api.connectRemoteTarget).toHaveBeenCalledWith({
      executionTargetId: TARGET_ID,
      credentials: { method: 'password', password: 'memory-only' }
    }));
    expect(await screen.findByText('/home/builder')).toBeInTheDocument();
    expect(screen.queryByText('All sessions')).not.toBeInTheDocument();
  });

  it('requires host verification in the local window before authentication', async () => {
    const api = {
      listRemoteTargets: vi.fn().mockResolvedValue([{
        ...summary,
        profile: { ...summary.profile, verifiedHostFingerprint: null }
      }])
    } as unknown as LumoraApi;

    render(<RemoteTargetWindow executionTargetId={TARGET_ID} api={api} />);
    expect(await screen.findByText(/verify this computer in the local Lumora window/i))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
  });
});
