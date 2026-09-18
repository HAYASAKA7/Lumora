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
  event: z.enum(['stop', 'notification', 'turn-complete'])
});

type HookEvent = z.infer<typeof HookMessageSchema>['event'];

const OUTCOME_BY_EVENT: Readonly<Record<HookEvent, SessionOutcomeKind>> = {
  stop: 'finished',
  notification: 'needs_you',
  'turn-complete': 'finished'
};

/** What one launch gains so its agent can report, and how to take it away again. */
export interface StatusHookLaunch {
  /** Placed before the provider's own arguments. */
  args: readonly string[];
  /** The outcomes these hooks report; the agent's own bell still speaks for the rest. */
  covers: readonly SessionOutcomeKind[];
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
  createToken?(): string;
}

/**
 * Adds hooks to the launch of a Claude Code or Codex terminal so the agent can
 * say when it finished or needs you, and listens for them.
 *
 * Nothing is written to the person's own agent configuration: Claude Code gets
 * a settings file of its own through `--settings`, which it loads on top of
 * theirs, and Codex gets `-c notify=…` for this launch only. Codex's override
 * replaces the person's own `notify`, so theirs is passed on to be run as well;
 * when their configuration cannot be read for certain, Codex gets no hook at
 * all rather than silently losing theirs. A launch through a custom command
 * gets nothing either: an unknown wrapper might reject the extra arguments.
 *
 * Each launch has its own random token, and only a message carrying a live
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
      LUMORA_STATUS_TOKEN: token
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
          Stop: [{ hooks: [{ type: 'command', command: `${command} --event stop` }] }],
          Notification: [{ hooks: [{ type: 'command', command: `${command} --event notification` }] }]
        }
      }, null, 2), { mode: 0o600 });
      this.runtimeByToken.set(token, input.runtimeId);
      return {
        args: ['--settings', settingsPath],
        covers: ['finished', 'needs_you'],
        environment,
        dispose: () => {
          this.runtimeByToken.delete(token);
          void rm(settingsPath, { force: true }).catch(() => undefined);
        }
      };
    }

    // Literal strings: nothing inside them is an escape, and Windows PowerShell
    // passes no double quotes through to a native program intact.
    if (/['\r\n]/.test(helper)) return null;
    const existing = readCodexNotify(await this.options.readCodexConfig(input.environment) ?? '');
    if (existing.state === 'unreadable') return null;
    if (existing.state === 'present') {
      environment.LUMORA_STATUS_CHAIN = JSON.stringify(existing.command);
    }
    this.runtimeByToken.set(token, input.runtimeId);
    return {
      args: ['-c', `notify=['${helper}','notify','--event','turn-complete']`],
      // Codex's notify reports a finished turn only; asking for approval is its bell's to say.
      covers: ['finished'],
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
    this.options.onOutcome(runtimeId, OUTCOME_BY_EVENT[message.data.event]);
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
