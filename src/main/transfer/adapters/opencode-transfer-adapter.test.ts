import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProviderSessionDiscoveryResult } from '../../providers/session-discovery';
import type { StructuredCommandRunner } from '../../providers/opencode-session-source';
import {
  buildOpenCodeTransferInvocation,
  createOpenCodeTransferAdapter
} from './opencode-transfer-adapter';

const installation = {
  provider: 'opencode' as const,
  displayName: 'OpenCode',
  state: 'ready' as const,
  executablePath: '/usr/local/bin/opencode',
  version: '1.15.7',
  issue: null
};

const exportedSession = {
  info: {
    id: 'ses_archived',
    directory: '/old/workspace',
    title: 'Transfer me',
    time: { created: 1_752_000_000_000, updated: 1_752_000_100_000 }
  },
  messages: [
    {
      info: { id: 'msg_1', sessionID: 'ses_archived', role: 'user' },
      parts: [{ type: 'text', text: 'keep this byte-equivalent after parsing' }]
    }
  ]
};

function discovery(
  sessions: ProviderSessionDiscoveryResult['sessions'] = []
): ProviderSessionDiscoveryResult {
  return {
    provider: 'opencode',
    sessions,
    discoveredCount: sessions.length,
    unchangedCount: 0,
    invalidCount: 0
  };
}

describe('OpenCode transfer adapter', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'lumora-opencode-transfer-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('uses OpenCode native JSON commands without a shell on Unix', () => {
    expect(
      buildOpenCodeTransferInvocation({
        operation: 'import',
        executablePath: '/usr/local/bin/opencode',
        payloadPath: '/tmp/session.json',
        platform: 'darwin',
        env: {}
      })
    ).toEqual({
      file: '/usr/local/bin/opencode',
      args: ['import', '/tmp/session.json'],
      shell: false,
      windowsHide: true
    });
  });

  it('invokes a Windows command shim through ComSpec with verbatim arguments', () => {
    expect(
      buildOpenCodeTransferInvocation({
        operation: 'export',
        executablePath: 'C:\\Users\\Dev\\opencode.cmd',
        nativeSessionId: 'ses_safe-1',
        platform: 'win32',
        env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }
      })
    ).toEqual({
      file: 'C:\\Windows\\System32\\cmd.exe',
      args: [
        '/d',
        '/s',
        '/c',
        '""C:\\Users\\Dev\\opencode.cmd" export ses_safe-1"'
      ],
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: true
    });
  });

  it.each([
    'C:\\bad%path\\opencode.cmd',
    'C:\\bad"path\\opencode.cmd',
    'C:\\bad\npath\\opencode.cmd'
  ])('rejects unsafe Windows shim path %s', (executablePath) => {
    expect(() =>
      buildOpenCodeTransferInvocation({
        operation: 'export',
        executablePath,
        nativeSessionId: 'ses_safe',
        platform: 'win32',
        env: {}
      })
    ).toThrow();
  });

  it('exports validated JSON to an exclusive staging file', async () => {
    const runCommand: StructuredCommandRunner = vi.fn(async () => ({
      stdout: JSON.stringify(exportedSession),
      stderr: '',
      exitCode: 0
    }));
    const adapter = createOpenCodeTransferAdapter({
      platform: 'linux',
      env: {},
      runCommand,
      discoverSessions: async () => discovery()
    });
    const stagingDirectory = join(root, 'export');
    await mkdir(stagingDirectory);

    const payload = await adapter.exportSession({
      installation,
      nativeSessionId: 'ses_archived',
      expectedWorkspacePath: '/old/workspace',
      expectedTitle: 'Transfer me',
      stagingDirectory
    });

    expect(JSON.parse(await readFile(payload.payloadPath, 'utf8'))).toEqual(exportedSession);
    expect(runCommand).toHaveBeenCalledWith(expect.objectContaining({
      args: ['export', 'ses_archived'],
      env: expect.objectContaining({ NO_COLOR: '1' }),
      shell: false
    }));
  });

  it.each([
    { output: { stdout: '', stderr: '', exitCode: 1 }, code: 'OPENCODE_COMMAND_FAILED' },
    { output: { stdout: '', stderr: '', exitCode: 1, timedOut: true }, code: 'OPENCODE_COMMAND_TIMEOUT' },
    { output: { stdout: '', stderr: '', exitCode: 1, outputTruncated: true }, code: 'OPENCODE_OUTPUT_LIMIT' }
  ])('rejects failed, timed-out, or truncated export commands', async ({ output, code }) => {
    const adapter = createOpenCodeTransferAdapter({
      platform: 'linux',
      env: {},
      runCommand: async () => output,
      discoverSessions: async () => discovery()
    });
    const stagingDirectory = join(root, code);
    await mkdir(stagingDirectory);
    await expect(
      adapter.exportSession({
        installation,
        nativeSessionId: 'ses_archived',
        expectedWorkspacePath: '/old/workspace',
        expectedTitle: 'Transfer me',
        stagingDirectory
      })
    ).rejects.toMatchObject({ code });
  });

  it('rewrites only the validated session directory in staged JSON', async () => {
    const payloadPath = join(root, 'session.json');
    await writeFile(payloadPath, JSON.stringify(exportedSession));
    const adapter = createOpenCodeTransferAdapter({
      platform: 'linux',
      env: {},
      runCommand: async () => ({
        stdout: 'Imported session: ses_archived',
        stderr: '',
        exitCode: 0
      }),
      discoverSessions: async () => discovery()
    });
    const inspection = await adapter.inspectImport({ payloadPath });
    const stagingDirectory = join(root, 'import');
    await mkdir(stagingDirectory);
    await adapter.importSession({
      installation,
      inspection,
      destinationWorkspacePath: '/new/workspace',
      stagingDirectory
    });

    const staged = JSON.parse(
      await readFile(join(stagingDirectory, 'opencode-import.json'), 'utf8')
    );
    expect(staged.info.directory).toBe('/new/workspace');
    expect(staged.messages).toEqual(exportedSession.messages);
    expect({ ...staged.info, directory: exportedSession.info.directory }).toEqual(
      exportedSession.info
    );
  });

  it('rejects a relative destination workspace before invoking import', async () => {
    const payloadPath = join(root, 'relative-workspace.json');
    await writeFile(payloadPath, JSON.stringify(exportedSession));
    const runCommand = vi.fn<StructuredCommandRunner>();
    const adapter = createOpenCodeTransferAdapter({
      platform: 'linux',
      env: {},
      runCommand,
      discoverSessions: async () => discovery()
    });
    const inspection = await adapter.inspectImport({ payloadPath });

    await expect(
      adapter.importSession({
        installation,
        inspection,
        destinationWorkspacePath: 'relative/workspace',
        stagingDirectory: root
      })
    ).rejects.toMatchObject({ code: 'OPENCODE_WORKSPACE_PATH_INVALID' });
    expect(runCommand).not.toHaveBeenCalled();
  });
  it('skips a duplicate native ID before invoking import', async () => {
    const payloadPath = join(root, 'duplicate.json');
    await writeFile(payloadPath, JSON.stringify(exportedSession));
    const runCommand = vi.fn<StructuredCommandRunner>();
    const adapter = createOpenCodeTransferAdapter({
      platform: 'linux',
      env: {},
      runCommand,
      discoverSessions: async () => discovery([
        {
          provider: 'opencode',
          nativeId: 'ses_archived',
          workspacePath: '/old/workspace',
          title: 'Transfer me',
          createdAt: '2026-07-29T00:00:00.000Z',
          updatedAt: '2026-07-29T00:01:00.000Z',
          source: { key: 'opencode:ses_archived', fingerprint: null }
        }
      ])
    });
    const inspection = await adapter.inspectImport({ payloadPath });
    const outcome = await adapter.importSession({
      installation,
      inspection,
      destinationWorkspacePath: '/new/workspace',
      stagingDirectory: root
    });

    expect(outcome).toEqual({
      status: 'duplicate',
      nativeSessionId: 'ses_archived'
    });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('returns the imported identity when cancellation arrives after provider mutation', async () => {
    const payloadPath = join(root, 'cancelled-after-import.json');
    await writeFile(payloadPath, JSON.stringify(exportedSession));
    const controller = new AbortController();
    const adapter = createOpenCodeTransferAdapter({
      platform: 'linux',
      env: {},
      runCommand: async () => {
        controller.abort();
        return {
          stdout: 'Imported session: ses_archived',
          stderr: '',
          exitCode: 0
        };
      },
      discoverSessions: async () => discovery()
    });
    const inspection = await adapter.inspectImport({ payloadPath });

    await expect(
      adapter.importSession({
        installation,
        inspection,
        destinationWorkspacePath: '/new/workspace',
        stagingDirectory: root,
        signal: controller.signal
      })
    ).resolves.toMatchObject({
      status: 'imported',
      nativeSessionId: 'ses_archived'
    });
  });

  it('rolls back when OpenCode assigns a different native ID', async () => {
    const payloadPath = join(root, 'changed-id.json');
    await writeFile(payloadPath, JSON.stringify(exportedSession));
    const runCommand = vi.fn<StructuredCommandRunner>(async (invocation) =>
      invocation.args.includes('import')
        ? { stdout: 'Imported session: ses_new', stderr: '', exitCode: 0 }
        : { stdout: '', stderr: '', exitCode: 0 }
    );
    const adapter = createOpenCodeTransferAdapter({
      platform: 'linux',
      env: {},
      runCommand,
      discoverSessions: async () => discovery()
    });
    const inspection = await adapter.inspectImport({ payloadPath });
    await expect(
      adapter.importSession({
        installation,
        inspection,
        destinationWorkspacePath: '/new/workspace',
        stagingDirectory: root
      })
    ).rejects.toMatchObject({ code: 'OPENCODE_NATIVE_ID_CHANGED' });
    expect(runCommand).toHaveBeenCalledWith(
      expect.objectContaining({ args: ['session', 'delete', 'ses_new'] })
    );
  });

  it('verifies the exact native ID, workspace, and title after discovery', async () => {
    const adapter = createOpenCodeTransferAdapter({
      platform: 'linux',
      env: {},
      runCommand: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      discoverSessions: async () => discovery([
        {
          provider: 'opencode',
          nativeId: 'ses_archived',
          workspacePath: '/new/workspace',
          title: 'Transfer me',
          createdAt: '2026-07-29T00:00:00.000Z',
          updatedAt: '2026-07-29T00:01:00.000Z',
          source: { key: 'opencode:ses_archived', fingerprint: null }
        }
      ])
    });
    await expect(
      adapter.verifyImportedSession({
        installation,
        nativeSessionId: 'ses_archived',
        workspacePath: '/new/workspace',
        title: 'Transfer me'
      })
    ).resolves.toBe(true);
    await expect(
      adapter.verifyImportedSession({
        installation,
        nativeSessionId: 'ses_archived',
        workspacePath: '/wrong/workspace',
        title: 'Transfer me'
      })
    ).resolves.toBe(false);
  });
});
