import { randomBytes } from 'node:crypto';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { join } from 'node:path';

import { z } from 'zod';

import type { ProviderId, SessionOutcomeKind } from '../../shared/contracts';
import { readCodexNotify } from './codex-notify-config';

/** A hook says one short line; anything longer is not one of ours. */
const MAX_MESSAGE_CHARS = 1_024;
const CONNECTION_TIMEOUT_MS = 2_000;

const HookMessageSchema = z.strictObject({
  token: z.string().regex(/^[a-f0-9]{64}$/),
  event: z.enum(['prompt-submit', 'stop', 'notification', 'turn-complete', 'interrupt'])
});

type HookEvent = z.infer<typeof HookMessageSchema>['event'];

const OUTCOME_BY_EVENT: Readonly<Partial<Record<HookEvent, SessionOutcomeKind>>> = {
  stop: 'finished',
  notification: 'needs_you',
  'turn-complete': 'finished'
};

/**
 * Codex's lifecycle hooks and the event each one reports. `Interrupt` is a turn
 * you stopped yourself: the spinner stops and nothing else is said.
 */
const CODEX_HOOK_EVENTS: ReadonlyArray<readonly [string, HookEvent]> = [
  ['UserPromptSubmit', 'prompt-submit'],
  ['Stop', 'stop'],
  ['PermissionRequest', 'notification'],
  ['Interrupt', 'interrupt']
];

/** What one launch gains so its agent can report, and how to take it away again. */
export interface StatusHookLaunch {
  /** Placed before the provider's own arguments. */
  args: readonly string[];
  environment: Readonly<Record<string, string>>;
  dispose(): void;
}

export interface SessionStatusHooksOptions {
  platform: NodeJS.Platform;
  /** A named pipe on Windows, a unix socket path elsewhere. */
  endpoint: string;
  /** Where each Claude Code launch's settings file is written. */
  settingsDirectory: string;
  /** The helper binary for this computer, or null when it cannot be found. */
  resolveHelper(): Promise<string | null>;
  /** The text of Codex's `config.toml` for this launch, or null when there is none. */
  readCodexConfig(environment: Readonly<Record<string, string | undefined>>): Promise<string | null>;
  onOutcome(runtimeId: string, outcome: SessionOutcomeKind): void;
  /** The agent started on a prompt: it is working until it finishes. */
  onWorking(runtimeId: string): void;
  /** A turn you stopped yourself ended: no longer working, and nothing to say. */
  onIdle(runtimeId: string): void;
  createToken?(): string;
}

/**
 * Adds hooks to the launch of a Claude Code or Codex terminal so the agent can
 * say when it starts working, finishes, or needs you, and listens for them.
 *
 * Nothing is written to the person's own agent configuration. Claude Code gets
 * a settings file of its own through `--settings`, which it loads on top of
 * theirs. Codex gets its lifecycle hooks through `-c` for this launch; Codex
 * runs them only once the person has trusted them in `/hooks`, and the command
 * never changes between launches, so trusting it once lasts. Until then Codex's
 * `notify`, also overridden for the launch, still reports a finished turn; it
 * replaces the person's own `notify`, so theirs is passed on to be run as well,
 * and when their configuration cannot be read for certain it is left alone. A
 * launch through a custom command gets nothing: an unknown wrapper might reject
 * the extra arguments.
 *
 * Each launch has its own random token, carried in the environment under a
 * name that agents do not strip as a secret, and only a message carrying a live
 * token is heard. The message is an event name, never conversation text.
 */
export class SessionStatusHooks {
  private server: Server | null = null;
  private readonly runtimeByToken = new Map<string, string>();
  private helper: Promise<string | null> | null = null;

  constructor(private readonly options: SessionStatusHooksOptions) {}

  async start(): Promise<void> {
    if (this.server !== null) return;
    if (this.options.platform !== 'win32') {
      await rm(this.options.endpoint, { force: true });
    }
    const server = createServer((socket) => this.accept(socket));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.options.endpoint, () => {
        server.off('error', reject);
        resolve();
      });
    });
    server.on('error', () => undefined);
    if (this.options.platform !== 'win32') {
      await chmod(this.options.endpoint, 0o600);
    }
    this.server = server;
  }

  async prepare(input: {
    runtimeId: string;
    provider: ProviderId;
    command: string | null;
    environment: Readonly<Record<string, string | undefined>>;
  }): Promise<StatusHookLaunch | null> {
    if (this.server === null || input.command !== null) return null;
    if (input.provider !== 'claude' && input.provider !== 'codex') return null;
    const helper = await this.resolveHelper();
    if (helper === null) return null;

    const token = this.options.createToken?.() ?? randomBytes(32).toString('hex');
    const environment: Record<string, string> = {
      LUMORA_STATUS_ENDPOINT: this.options.endpoint,
      LUMORA_STATUS_ID: token
    };

    if (input.provider === 'claude') {
      const command = claudeHookCommand(helper, this.options.platform);
      if (command === null) return null;
      await mkdir(this.options.settingsDirectory, { recursive: true });
      // Named apart from the token: the path is on the command line, where
      // anyone listing processes can read it.
      const settingsPath = join(
        this.options.settingsDirectory,
        `${randomBytes(12).toString('hex')}.json`
      );
      await writeFile(settingsPath, JSON.stringify({
        hooks: {
          UserPromptSubmit: [{ hooks: [{ type: 'command', command: `${command} --event prompt-submit` }] }],
          Stop: [{ hooks: [{ type: 'command', command: `${command} --event stop` }] }],
          Notification: [{ hooks: [{ type: 'command', command: `${command} --event notification` }] }]
        }
      }, null, 2), { mode: 0o600 });
      this.runtimeByToken.set(token, input.runtimeId);
      return {
        args: ['--settings', settingsPath],
        environment,
        dispose: () => {
          this.runtimeByToken.delete(token);
          void rm(settingsPath, { force: true }).catch(() => undefined);
        }
      };
    }

    const hookCommand = codexHookCommand(helper, this.options.platform);
    if (hookCommand === null) return null;
    // Literal strings throughout: nothing inside them is an escape, and
    // Windows PowerShell passes no double quotes through to a native program.
    const args: string[] = ['-c', 'features.hooks=true'];
    for (const [hookEvent, event] of CODEX_HOOK_EVENTS) {
      args.push(
        '-c',
        `hooks.${hookEvent}=[{hooks=[{type='command',command='${hookCommand} --event ${event}'}]}]`
      );
    }
    const existing = readCodexNotify(await this.options.readCodexConfig(input.environment) ?? '');
    if (existing.state !== 'unreadable') {
      args.push('-c', `notify=['${helper}','notify','--event','turn-complete']`);
      if (existing.state === 'present') {
        environment.LUMORA_STATUS_CHAIN = JSON.stringify(existing.command);
      }
    }
    this.runtimeByToken.set(token, input.runtimeId);
    return {
      args,
      environment,
      dispose: () => {
        this.runtimeByToken.delete(token);
      }
    };
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.runtimeByToken.clear();
    if (server === null) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (this.options.platform !== 'win32') {
      await rm(this.options.endpoint, { force: true }).catch(() => undefined);
    }
  }

  private resolveHelper(): Promise<string | null> {
    this.helper ??= this.options.resolveHelper().catch(() => null);
    return this.helper;
  }

  private accept(socket: Socket): void {
    let received = '';
    socket.setEncoding('utf8');
    socket.setTimeout(CONNECTION_TIMEOUT_MS, () => socket.destroy());
    socket.on('error', () => undefined);
    socket.on('data', (chunk: string) => {
      received += chunk;
      const newline = received.indexOf('\n');
      if (newline === -1) {
        if (received.length > MAX_MESSAGE_CHARS) socket.destroy();
        return;
      }
      this.receive(received.slice(0, newline));
      socket.end();
    });
  }

  private receive(line: string): void {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return;
    }
    const message = HookMessageSchema.safeParse(value);
    if (!message.success) return;
    const runtimeId = this.runtimeByToken.get(message.data.token);
    if (runtimeId === undefined) return;
    const { event } = message.data;
    if (event === 'prompt-submit') {
      this.options.onWorking(runtimeId);
      return;
    }
    if (event === 'interrupt') {
      this.options.onIdle(runtimeId);
      return;
    }
    const outcome = OUTCOME_BY_EVENT[event];
    if (outcome !== undefined) this.options.onOutcome(runtimeId, outcome);
  }
}

/**
 * The shell command Claude Code runs for a hook. The path is quoted, with
 * forward slashes on Windows so the same line reads alike in bash and cmd, and
 * a path a shell could read as more than a path gets no hook.
 */
function claudeHookCommand(helper: string, platform: NodeJS.Platform): string | null {
  const path = platform === 'win32' ? helper.replaceAll('\\', '/') : helper;
  if (/["$`\\\r\n%!]/.test(path)) return null;
  return `"${path}" notify`;
}

/**
 * The command Codex runs for a hook, through `cmd.exe /C` on Windows and
 * `/bin/sh -lc` elsewhere. It sits inside a TOML literal string passed as one
 * argument, so it holds no single quote, and no double quote either unless the
 * path has a space, since Windows PowerShell drops them on the way to Codex. A
 * path a shell could read as more than a path gets no hook.
 */
function codexHookCommand(helper: string, platform: NodeJS.Platform): string | null {
  const unsafe = platform === 'win32' ? /['"%!^&|<>()\r\n]/ : /['"$`\\!&|;<>()\r\n]/;
  if (unsafe.test(helper)) return null;
  const path = /\s/.test(helper) ? `"${helper}"` : helper;
  return `${path} notify`;
}
