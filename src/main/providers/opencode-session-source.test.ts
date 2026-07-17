import { describe, expect, it, vi } from 'vitest';

import type { ProviderInstallation } from '../../shared/contracts';
import { openCodeSessionRow } from './fixtures/opencode-session-list';
import {
  OpenCodeSessionSourceError,
  buildOpenCodeSessionInvocation,
  discoverOpenCodeSessions,
  type StructuredCommandRunner
} from './opencode-session-source';

const installation: Extract<ProviderInstallation, { state: 'ready' }> = {
  provider: 'opencode',
  displayName: 'OpenCode',
  state: 'ready',
  executablePath: '/tools/opencode',
  version: 'opencode 1.0.0',
  issue: null
};

function runnerWith(stdout: string): StructuredCommandRunner {
  return vi.fn(async () => ({ stdout, stderr: '', exitCode: 0 }));
}

describe('discoverOpenCodeSessions', () => {
  it('invokes the structured list command and reads metadata only', async () => {
    const runCommand = runnerWith(
      JSON.stringify([
        openCodeSessionRow({ privatePrompt: 'must not enter the catalog' })
      ])
    );

    const result = await discoverOpenCodeSessions({
      installation,
      env: { PATH: '/tools' },
      runCommand
    });

    expect(runCommand).toHaveBeenCalledWith({
      file: '/tools/opencode',
      args: ['session', 'list', '--format', 'json'],
      env: { PATH: '/tools', NO_COLOR: '1' },
      shell: false,
      windowsHide: true,
      timeoutMs: 15_000,
      maxOutputBytes: 4 * 1024 * 1024
    });
    expect(result).toEqual({
      provider: 'opencode',
      sessions: [
        {
          provider: 'opencode',
          nativeId: 'ses_01JABC',
          workspacePath: '/work/lumora',
          title: 'Implement provider facets',
          createdAt: new Date(1_784_270_000_000).toISOString(),
          updatedAt: new Date(1_784_270_300_000).toISOString(),
          source: { key: 'opencode:ses_01JABC', fingerprint: null }
        }
      ],
      discoveredCount: 1,
      unchangedCount: 0,
      invalidCount: 0
    });
    expect(JSON.stringify(result)).not.toContain('must not enter');
  });

  it('accepts Windows paths and isolates malformed rows', async () => {
    const runCommand = runnerWith(
      JSON.stringify([
        openCodeSessionRow({
          id: 'windows-session',
          directory: 'D:\\code\\lumora',
          title: '  Windows work  '
        }),
        openCodeSessionRow({ id: '', directory: '/work/invalid' }),
        openCodeSessionRow({ id: 'relative', directory: 'relative/path' }),
        { id: 'missing-fields' }
      ])
    );

    const result = await discoverOpenCodeSessions({
      installation,
      env: {},
      runCommand
    });

    expect(result.sessions[0]).toMatchObject({
      nativeId: 'windows-session',
      workspacePath: 'D:\\code\\lumora',
      title: 'Windows work'
    });
    expect(result.invalidCount).toBe(3);
  });

  it('deduplicates native ids using the newest valid metadata', async () => {
    const runCommand = runnerWith(
      JSON.stringify([
        openCodeSessionRow({ id: 'duplicate', title: 'Old' }),
       openCodeSessionRow({
         id: 'duplicate',
         title: 'New',
          updated: 1_784_270_400_000
        })
      ])
    );

    const result = await discoverOpenCodeSessions({
      installation,
      env: {},
      runCommand
    });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]!.title).toBe('New');
  });

  it.each([
    [{ exitCode: 1, stdout: '[]', stderr: 'private detail' }, 'command failed'],
    [{ exitCode: 0, stdout: '[]', stderr: '', timedOut: true }, 'timed out'],
    [
      { exitCode: 0, stdout: '[]', stderr: '', outputTruncated: true },
      'output limit'
    ]
  ] as const)('rejects failed bounded command output', async (output, message) => {
    await expect(
      discoverOpenCodeSessions({
        installation,
        env: {},
        runCommand: async () => output
      })
    ).rejects.toThrow(message);
  });

  it.each(['{}', 'not json'])('rejects output that is not a JSON array', async (stdout) => {
    await expect(
      discoverOpenCodeSessions({
        installation,
        env: {},
        runCommand: runnerWith(stdout)
      })
    ).rejects.toBeInstanceOf(OpenCodeSessionSourceError);
  });

  it('routes Windows npm command shims through ComSpec without a shell', () => {
    expect(
      buildOpenCodeSessionInvocation('C:\\Tools\\opencode.cmd', {
        platform: 'win32',
        env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }
      })
    ).toEqual({
      file: 'C:\\Windows\\System32\\cmd.exe',
      args: [
        '/d',
        '/s',
        '/c',
        '""C:\\Tools\\opencode.cmd" session list --format json"'
      ],
      windowsVerbatimArguments: true
    });
  });
});
