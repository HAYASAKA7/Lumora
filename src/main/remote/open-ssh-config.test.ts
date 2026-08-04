import { describe, expect, it, vi } from 'vitest';

import {
  createOpenSshConfigResolver,
  parseOpenSshEffectiveConfig
} from './open-ssh-config';

describe('OpenSSH configuration resolution', () => {
  it('parses the effective host, port, and user emitted by ssh -G', () => {
    expect(parseOpenSshEffectiveConfig([
      'host build-alias',
      'hostname 10.0.0.8',
      'user builder',
      'port 2202',
      'canonicalizehostname false'
    ].join('\n'))).toEqual({
      host: '10.0.0.8',
      port: 2202,
      username: 'builder'
    });
  });

  it('rejects incomplete, malformed, or jump-host configurations', () => {
    expect(() => parseOpenSshEffectiveConfig('hostname build.internal\nport nope'))
      .toThrow('invalid OpenSSH configuration');
    expect(() => parseOpenSshEffectiveConfig([
      'hostname build.internal',
      'user builder',
      'port 22',
      'proxyjump bastion'
    ].join('\n'))).toThrow('jump hosts are not supported');
  });

  it('runs the system OpenSSH resolver with bounded output and sanitized failures', async () => {
    const run = vi.fn().mockResolvedValue({
      stdout: 'hostname build.internal\nuser builder\nport 22\n'
    });
    const resolve = createOpenSshConfigResolver({ run });

    await expect(resolve('build-alias')).resolves.toEqual({
      host: 'build.internal',
      port: 22,
      username: 'builder'
    });
    expect(run).toHaveBeenCalledWith(
      'ssh',
      ['-G', '--', 'build-alias'],
      expect.objectContaining({ timeoutMs: 10_000, maxOutputBytes: 64 * 1024 })
    );

    run.mockRejectedValueOnce(new Error('C:\\Users\\private\\.ssh\\config'));
    await expect(resolve('broken-alias')).rejects.toMatchObject({
      code: 'SSH_CONNECTION_FAILED',
      message: 'Lumora could not resolve the OpenSSH host alias.'
    });
  });
});
