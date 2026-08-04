import { describe, expect, it } from 'vitest';

import { resolveDefaultSshAgentSocket } from './ssh-client';

describe('default SSH agent socket', () => {
  it('uses SSH_AUTH_SOCK on macOS and Linux', () => {
    expect(resolveDefaultSshAgentSocket('darwin', {
      SSH_AUTH_SOCK: '/private/tmp/agent.sock'
    })).toBe('/private/tmp/agent.sock');
    expect(resolveDefaultSshAgentSocket('linux', {
      SSH_AUTH_SOCK: '/run/user/1000/ssh-agent.socket'
    })).toBe('/run/user/1000/ssh-agent.socket');
  });

  it('falls back to the Windows OpenSSH agent named pipe', () => {
    expect(resolveDefaultSshAgentSocket('win32', {})).toBe(
      '\\\\.\\pipe\\openssh-ssh-agent'
    );
  });

  it('does not invent a socket on POSIX systems', () => {
    expect(resolveDefaultSshAgentSocket('linux', {})).toBeNull();
  });
});
