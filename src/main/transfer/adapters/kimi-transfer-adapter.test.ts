import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SystemInfo } from '../../../shared/contracts';
import { kimiState, kimiWire } from '../../providers/fixtures/kimi-session-recordings';
import {
  createKimiTransferAdapter,
  kimiWorkDirectoryKey
} from './kimi-transfer-adapter';

const nativeSessionId = 'session_123e4567-e89b-42d3-a456-426614174000';
const installation = {
  provider: 'kimi' as const,
  displayName: 'Kimi Code',
  state: 'ready' as const,
  executablePath: '/usr/local/bin/kimi',
  version: '1.41.0',
  issue: null
};
const platform: SystemInfo['platform'] = process.platform === 'win32'
  ? 'win32'
  : process.platform === 'darwin'
    ? 'darwin'
    : 'linux';

interface SessionFixture {
  sessionDirectory: string;
  statePath: string;
  mainWirePath: string;
}

async function writeSession(
  kimiRoot: string,
  workspacePath: string
): Promise<SessionFixture> {
  const sessionDirectory = join(
    kimiRoot,
    'sessions',
    kimiWorkDirectoryKey(workspacePath),
    nativeSessionId
  );
  const statePath = join(sessionDirectory, 'state.json');
  const mainWirePath = join(sessionDirectory, 'agents', 'main', 'wire.jsonl');
  await mkdir(dirname(mainWirePath), { recursive: true });
  await mkdir(join(sessionDirectory, 'agents', 'agent-0'), { recursive: true });
  await writeFile(statePath, kimiState(), 'utf8');
  await writeFile(mainWirePath, `${kimiWire().join('\n')}\n`, 'utf8');
  await writeFile(
    join(sessionDirectory, 'agents', 'agent-0', 'wire.jsonl'),
    '{"type":"turn.prompt","content":"subagent"}\n',
    'utf8'
  );
  await writeFile(
    join(sessionDirectory, 'upcoming-goals.json'),
    '{"goals":[]}\n',
    'utf8'
  );
  return { sessionDirectory, statePath, mainWirePath };
}

describe('Kimi transfer adapter', () => {
  let root: string;
  let sourceRoot: string;
  let destinationRoot: string;
  let sourceWorkspace: string;
  let fixture: SessionFixture;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'lumora-kimi-transfer-')));
    sourceRoot = join(root, 'source-kimi');
    destinationRoot = join(root, 'destination-kimi');
    sourceWorkspace = join(root, 'Source Workspace');
    fixture = await writeSession(sourceRoot, sourceWorkspace);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('uses Kimi native workspace bucket names for POSIX and Windows paths', () => {
    expect(kimiWorkDirectoryKey('/Users/Dev/My App')).toBe(
      'wd_my-app_fe8fc4b5d49e'
    );
    expect(kimiWorkDirectoryKey('C:\\Users\\Dev\\My App')).toBe(
      'wd_my-app_323797d9ab9c'
    );
  });

  it('exports one bounded provider-owned session directory', async () => {
    const stagingDirectory = join(root, 'export');
    await mkdir(stagingDirectory);
    const adapter = createKimiTransferAdapter({
      platform,
      kimiRoot: sourceRoot
    });

    const payload = await adapter.exportSession({
      installation,
      nativeSessionId,
      sourceKeys: [fixture.statePath],
      expectedWorkspacePath: sourceWorkspace,
      expectedTitle: 'Build Kimi support',
      stagingDirectory
    });
    const envelope = JSON.parse(await readFile(payload.payloadPath, 'utf8')) as {
      provider: string;
      nativeSessionId: string;
      files: { path: string }[];
    };

    expect(envelope).toMatchObject({ provider: 'kimi', nativeSessionId });
    expect(envelope.files.map((file) => file.path).sort()).toEqual([
      'agents/agent-0/wire.jsonl',
      'agents/main/wire.jsonl',
      'state.json',
      'upcoming-goals.json'
    ]);
    expect(JSON.stringify(envelope)).not.toContain('credentials');
  });

  it('imports into the mapped native workspace and remains discoverable', async () => {
    const exportDirectory = join(root, 'export-import');
    await mkdir(exportDirectory);
    const sourceAdapter = createKimiTransferAdapter({
      platform,
      kimiRoot: sourceRoot
    });
    const destinationAdapter = createKimiTransferAdapter({
      platform,
      kimiRoot: destinationRoot
    });
    const payload = await sourceAdapter.exportSession({
      installation,
      nativeSessionId,
      sourceKeys: [fixture.statePath],
      expectedWorkspacePath: sourceWorkspace,
      expectedTitle: 'Build Kimi support',
      stagingDirectory: exportDirectory
    });
    const inspection = await destinationAdapter.inspectImport({
      payloadPath: payload.payloadPath
    });
    const destinationWorkspace = join(root, 'Destination Workspace');

    const result = await destinationAdapter.importSession({
      installation,
      inspection,
      destinationWorkspacePath: destinationWorkspace,
      stagingDirectory: root
    });
    const destinationSession = join(
      destinationRoot,
      'sessions',
      kimiWorkDirectoryKey(destinationWorkspace),
      nativeSessionId
    );

    expect(result).toEqual({
      status: 'imported',
      nativeSessionId,
      payloadPath: join(destinationSession, 'state.json')
    });
    await expect(readFile(
      join(destinationSession, 'agents', 'main', 'wire.jsonl'),
      'utf8'
    )).resolves.toBe(await readFile(fixture.mainWirePath, 'utf8'));
    expect(await readFile(join(destinationRoot, 'session_index.jsonl'), 'utf8'))
      .toContain(JSON.stringify({
        sessionId: nativeSessionId,
        sessionDir: destinationSession,
        workDir: destinationWorkspace
      }));
    await expect(destinationAdapter.verifyImportedSession({
      installation,
      nativeSessionId,
      workspacePath: destinationWorkspace,
      title: 'Build Kimi support'
    })).resolves.toBe(true);
    await expect(destinationAdapter.importSession({
      installation,
      inspection,
      destinationWorkspacePath: destinationWorkspace,
      stagingDirectory: root
    })).resolves.toEqual({ status: 'duplicate', nativeSessionId });
  });

  it('rejects tampered payloads and sources outside the native workspace bucket', async () => {
    const exportDirectory = join(root, 'tampered');
    await mkdir(exportDirectory);
    const adapter = createKimiTransferAdapter({
      platform,
      kimiRoot: sourceRoot
    });
    const payload = await adapter.exportSession({
      installation,
      nativeSessionId,
      sourceKeys: [fixture.statePath],
      expectedWorkspacePath: sourceWorkspace,
      expectedTitle: 'Build Kimi support',
      stagingDirectory: exportDirectory
    });
    const envelope = JSON.parse(await readFile(payload.payloadPath, 'utf8')) as {
      files: { path: string; contentBase64: string }[];
    };
    envelope.files.find((file) => file.path === 'state.json')!.contentBase64 =
      Buffer.from('{}').toString('base64');
    await writeFile(payload.payloadPath, JSON.stringify(envelope), 'utf8');

    await expect(adapter.inspectImport({ payloadPath: payload.payloadPath }))
      .rejects.toThrow('integrity');

    const wrongDirectory = join(sourceRoot, 'sessions', 'wrong', nativeSessionId);
    await mkdir(wrongDirectory, { recursive: true });
    const wrongState = join(wrongDirectory, 'state.json');
    await writeFile(wrongState, kimiState(), 'utf8');
    await expect(adapter.exportSession({
      installation,
      nativeSessionId,
      sourceKeys: [wrongState],
      expectedWorkspacePath: sourceWorkspace,
      expectedTitle: 'Build Kimi support',
      stagingDirectory: exportDirectory
    })).rejects.toThrow('expected provider workspace');
  });

  it('removes only the imported session and records native deletion on rollback', async () => {
    const destinationWorkspace = join(root, 'Rollback Workspace');
    const destinationSession = join(
      destinationRoot,
      'sessions',
      kimiWorkDirectoryKey(destinationWorkspace),
      nativeSessionId
    );
    await mkdir(join(destinationSession, 'agents', 'main'), { recursive: true });
    await writeFile(join(destinationSession, 'state.json'), kimiState(), 'utf8');
    await writeFile(
      join(destinationSession, 'agents', 'main', 'wire.jsonl'),
      `${kimiWire().join('\n')}\n`,
      'utf8'
    );
    await mkdir(destinationRoot, { recursive: true });
    await writeFile(join(destinationRoot, 'session_index.jsonl'), `${JSON.stringify({
      sessionId: nativeSessionId,
      sessionDir: destinationSession,
      workDir: destinationWorkspace
    })}\n`, 'utf8');
    const adapter = createKimiTransferAdapter({
      platform,
      kimiRoot: destinationRoot
    });

    await adapter.rollbackImport({
      installation,
      nativeSessionId,
      workspacePath: destinationWorkspace
    });

    await expect(readFile(join(destinationSession, 'state.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });
    const index = await readFile(join(destinationRoot, 'session_index.jsonl'), 'utf8');
    expect(index.trim().split(/\r?\n/).at(-1)).toBe(JSON.stringify({
      sessionId: nativeSessionId,
      deleted: true
    }));
  });
});
