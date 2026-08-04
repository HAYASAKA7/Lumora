import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

    fireEvent.click(await screen.findByRole('button', { name: 'Add remote computer' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Build server' } });
    fireEvent.change(screen.getByLabelText('Host'), { target: { value: 'build.internal' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'builder' } });
    fireEvent.change(screen.getByLabelText('Authentication'), { target: { value: 'agent' } });
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

    fireEvent.click(await screen.findByRole('button', { name: 'Verify identity' }));
    expect(await screen.findByText(fingerprint)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Trust this fingerprint' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open remote Lumora' }));

    expect(api.trustRemoteHost).toHaveBeenCalledWith({
      executionTargetId: TARGET_ID, fingerprint
    });
    expect(api.openRemoteTargetWindow).toHaveBeenCalledWith(TARGET_ID);
  });
});
