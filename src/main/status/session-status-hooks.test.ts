import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionStatusHooks, type SessionStatusHooksOptions } from './session-status-hooks';

const TOKEN = 'a'.repeat(64);

let directory: string;
let hooks: SessionStatusHooks | null = null;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'lumora-status-hooks-'));
});

afterEach(async () => {
  await hooks?.close();
  hooks = null;
  await rm(directory, { recursive: true, force: true });
});

function endpoint(): string {
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\lumora-status-test-${randomBytes(6).toString('hex')}`
    : join(directory, 'status.sock');
}

async function started(overrides: Partial<SessionStatusHooksOptions> = {}) {
  const onOutcome = vi.fn();
  const onWorking = vi.fn();
  const onIdle = vi.fn();
  const options: SessionStatusHooksOptions = {
    platform: process.platform,
    endpoint: endpoint(),
    settingsDirectory: join(directory, 'claude-settings'),
    resolveHelper: async () => process.platform === 'win32'
      ? 'C:\\Program Files\\Lumora\\resources\\helper\\windows-x64\\lumora-helper.exe'
      : '/Applications/Lumora.app/Contents/Resources/helper/macos-arm64/lumora-helper',
    readCodexConfig: async () => null,
    onOutcome,
    onWorking,
    onIdle,
    createToken: () => TOKEN,
    ...overrides
  };
  hooks = new SessionStatusHooks(options);
  await hooks.start();
  return { hooks, onOutcome, onWorking, onIdle, options };
}

function send(path: string, line: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect(path, () => socket.end(line));
    socket.on('close', () => resolve());
    socket.on('error', reject);
  });
}

describe('SessionStatusHooks', () => {
  it('gives a Claude Code launch its own settings file and hears its hooks', async () => {
    const { hooks: service, onOutcome, options } = await started();
    const launch = await service.prepare({
      runtimeId: 'runtime-1',
      provider: 'claude',
      command: null,
      environment: {}
    });

    expect(launch?.args[0]).toBe('--settings');
    // The token travels in the environment only, never on the command line.
    expect(launch!.args.join(' ')).not.toContain(TOKEN);
    expect(launch?.environment).toEqual({
      LUMORA_STATUS_ENDPOINT: options.endpoint,
      LUMORA_STATUS_ID: TOKEN
    });
    const settings = JSON.parse(await readFile(launch!.args[1]!, 'utf8')) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    const stop = settings.hooks.Stop![0]!.hooks[0]!.command;
    expect(stop).toMatch(/^"[^"]+lumora-helper(\.exe)?" notify --event stop$/);
    expect(stop).not.toContain('\\');
    expect(settings.hooks.Notification![0]!.hooks[0]!.command).toMatch(/--event notification$/);
    expect(settings.hooks.UserPromptSubmit![0]!.hooks[0]!.command).toMatch(/--event prompt-submit$/);

    await send(options.endpoint, `${JSON.stringify({ token: TOKEN, event: 'stop' })}\n`);
    await vi.waitFor(() => expect(onOutcome).toHaveBeenCalledWith('runtime-1', 'finished'));
    await send(options.endpoint, `${JSON.stringify({ token: TOKEN, event: 'notification' })}\n`);
    await vi.waitFor(() => expect(onOutcome).toHaveBeenCalledWith('runtime-1', 'needs_you'));

    launch!.dispose();
    await vi.waitFor(() => expect(existsSync(launch!.args[1]!)).toBe(false));
    onOutcome.mockClear();
    await send(options.endpoint, `${JSON.stringify({ token: TOKEN, event: 'stop' })}\n`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onOutcome).not.toHaveBeenCalled();
  });

  it('hears the agent start on a prompt', async () => {
    const { hooks: service, onOutcome, onWorking, options } = await started();
    await service.prepare({ runtimeId: 'runtime-9', provider: 'claude', command: null, environment: {} });

    await send(options.endpoint, `${JSON.stringify({ token: TOKEN, event: 'prompt-submit' })}\n`);

    await vi.waitFor(() => expect(onWorking).toHaveBeenCalledWith('runtime-9'));
    expect(onOutcome).not.toHaveBeenCalled();
  });

  it('hears nothing from a message it did not issue', async () => {
    const { hooks: service, onOutcome, options } = await started();
    await service.prepare({ runtimeId: 'runtime-1', provider: 'claude', command: null, environment: {} });

    await send(options.endpoint, `${JSON.stringify({ token: 'b'.repeat(64), event: 'stop' })}\n`);
    await send(options.endpoint, `${JSON.stringify({ token: TOKEN, event: 'exec' })}\n`);
    await send(options.endpoint, 'not json\n');
    await send(options.endpoint, `${'x'.repeat(4_096)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(onOutcome).not.toHaveBeenCalled();
  });

  it('gives Codex its lifecycle hooks for the launch, and notify with the person\'s own passed on', async () => {
    const { hooks: service } = await started({
      resolveHelper: async () => '/opt/lumora/helper/lumora-helper',
      readCodexConfig: async () => 'notify = ["python3", "/home/me/notify.py"]\n'
    });
    const launch = await service.prepare({
      runtimeId: 'runtime-2',
      provider: 'codex',
      command: null,
      environment: {}
    });

    const hook = (event: string, reported: string) =>
      `hooks.${event}=[{hooks=[{type='command',command='/opt/lumora/helper/lumora-helper notify --event ${reported}'}]}]`;
    expect(launch?.args).toEqual([
      '-c', 'features.hooks=true',
      '-c', hook('UserPromptSubmit', 'prompt-submit'),
      '-c', hook('Stop', 'stop'),
      '-c', hook('PermissionRequest', 'notification'),
      '-c', hook('Interrupt', 'interrupt'),
      '-c', "notify=['/opt/lumora/helper/lumora-helper','notify','--event','turn-complete']"
    ]);
    // Windows PowerShell would drop a double quote on the way to Codex.
    expect(launch!.args.join(' ')).not.toContain('"');
    expect(launch?.environment.LUMORA_STATUS_CHAIN).toBe('["python3","/home/me/notify.py"]');
  });

  it('keeps the person\'s Codex notify untouched when it cannot be read for certain', async () => {
    const { hooks: service } = await started({
      readCodexConfig: async () => 'notify = "a string, not a list"\n'
    });
    const launch = await service.prepare({
      runtimeId: 'runtime-3',
      provider: 'codex',
      command: null,
      environment: {}
    });

    expect(launch?.args.some((arg) => arg.startsWith('notify='))).toBe(false);
    expect(launch?.args.some((arg) => arg.startsWith('hooks.Stop='))).toBe(true);
    expect(launch?.environment).not.toHaveProperty('LUMORA_STATUS_CHAIN');
  });

  it('hears a turn the person stopped as the agent no longer working', async () => {
    const { hooks: service, onIdle, onOutcome, options } = await started();
    await service.prepare({ runtimeId: 'runtime-8', provider: 'codex', command: null, environment: {} });

    await send(options.endpoint, `${JSON.stringify({ token: TOKEN, event: 'interrupt' })}\n`);

    await vi.waitFor(() => expect(onIdle).toHaveBeenCalledWith('runtime-8'));
    expect(onOutcome).not.toHaveBeenCalled();
  });

  it('adds nothing to a custom launch command, another agent, or without the helper', async () => {
    const { hooks: service } = await started();
    expect(await service.prepare({
      runtimeId: 'runtime-4', provider: 'claude', command: 'my-claude-wrapper', environment: {}
    })).toBeNull();
    expect(await service.prepare({
      runtimeId: 'runtime-5', provider: 'gemini', command: null, environment: {}
    })).toBeNull();

    await hooks!.close();
    const { hooks: withoutHelper } = await started({ resolveHelper: async () => null });
    expect(await withoutHelper.prepare({
      runtimeId: 'runtime-6', provider: 'claude', command: null, environment: {}
    })).toBeNull();
  });

  it('gives no hook to a helper path a shell could read as more than a path', async () => {
    const { hooks: service } = await started({
      resolveHelper: async () => '/opt/lumora $(touch pwned)/lumora-helper'
    });
    expect(await service.prepare({
      runtimeId: 'runtime-7', provider: 'claude', command: null, environment: {}
    })).toBeNull();
    expect(await service.prepare({
      runtimeId: 'runtime-7', provider: 'codex', command: null, environment: {}
    })).toBeNull();
  });
});
