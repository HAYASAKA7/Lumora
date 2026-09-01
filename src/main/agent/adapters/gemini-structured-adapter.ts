import { readFile, realpath, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import {
  basename,
  dirname,
  isAbsolute,
  posix,
  relative,
  resolve,
  win32
} from 'node:path';

import { z } from 'zod';

import type {
  StructuredAgentAction,
  StructuredAgentCommand
} from '../../../shared/agent/contracts';
import type { StructuredAgentEventDraft } from '../runtime/event-sequencer';
import { createFullTextUnifiedDiff } from '../diff/unified-diff';
import type {
  JsonRpcNotification,
  JsonRpcProviderRequest,
  LineJsonRpcTransport
} from '../transport/line-json-rpc';
import { spawnStructuredLineTransport } from '../transport/process-invocation';
import type {
  StructuredAgentAdapter,
  StructuredAgentAdapterContext
} from './structured-agent-adapter';

const InitializeSchema = z.object({
  protocolVersion: z.literal(1),
  authMethods: z.array(z.object({
    id: z.string().trim().min(1).max(128)
  }).passthrough()).optional().default([]),
  agentCapabilities: z.object({
    loadSession: z.boolean().optional().default(false)
  }).passthrough()
}).passthrough();

const SessionResponseSchema = z.object({
  sessionId: z.string().min(1).optional(),
  configOptions: z.array(z.unknown()).nullish(),
  models: z.unknown().nullish()
}).passthrough();
const PromptResponseSchema = z.object({
  stopReason: z.string(),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    cachedReadTokens: z.number().int().nonnegative().nullable().optional(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative()
  }).nullable().optional()
}).passthrough();

interface PendingPermission {
  turnId: string;
  options: Array<{ optionId: string; kind: string }>;
  resolve(value: unknown): void;
}

export interface GeminiStructuredTransportFactoryOptions {
  executablePath: string;
  workingDirectory: string;
  handleRequest(request: JsonRpcProviderRequest): Promise<unknown>;
}

export type GeminiStructuredTransportFactory = (
  options: GeminiStructuredTransportFactoryOptions
) => Promise<LineJsonRpcTransport>;

export interface CreateGeminiStructuredAdapterOptions {
  createTransport?: GeminiStructuredTransportFactory;
  resolveAuthenticationMethod?: () => Promise<string | null>;
}

type GeminiExecutablePlatform = 'win32' | 'darwin' | 'linux';
type GeminiEnvironment = Readonly<Record<string, string | undefined>>;
type ReadTextFile = (path: string) => Promise<string>;

function environmentValue(
  env: GeminiEnvironment,
  key: string,
  platform: GeminiExecutablePlatform
): string | undefined {
  if (platform !== 'win32') return env[key];
  const matched = Object.keys(env).find(
    (candidate) => candidate.toLowerCase() === key.toLowerCase()
  );
  return matched === undefined ? undefined : env[matched];
}

export async function resolveGeminiAuthenticationMethod(
  env: GeminiEnvironment = process.env,
  readText: ReadTextFile = (path) => readFile(path, 'utf8'),
  platform: GeminiExecutablePlatform = process.platform as GeminiExecutablePlatform
): Promise<string | null> {
  const configuredHome = environmentValue(env, 'GEMINI_CLI_HOME', platform)?.trim();
  const home = configuredHome && configuredHome.length > 0 ? configuredHome : homedir();
  const pathApi = platform === 'win32' ? win32 : posix;
  try {
    const settings = JSON.parse(
      await readText(pathApi.join(home, '.gemini', 'settings.json'))
    ) as unknown;
    const parsed = z.object({
      security: z.object({
        auth: z.object({ selectedType: z.string().trim().min(1).max(128) })
          .passthrough()
      }).passthrough()
    }).passthrough().safeParse(settings);
    if (parsed.success) return parsed.data.security.auth.selectedType;
  } catch {
    // Continue with explicit, non-secret environment signals below.
  }
  if (environmentValue(env, 'GEMINI_API_KEY', platform)?.trim()) {
    return 'gemini-api-key';
  }
  if (
    environmentValue(env, 'GOOGLE_GENAI_USE_VERTEXAI', platform)
      ?.trim().toLowerCase() === 'true'
  ) {
    return 'vertex-ai';
  }
  return null;
}

function bounded(value: string, max = 65_536): string {
  const text = value.slice(0, max);
  return text.length === 0 ? ' ' : text;
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : null;
}

function defaultTransportFactory(
  options: GeminiStructuredTransportFactoryOptions
): Promise<LineJsonRpcTransport> {
  const platform = process.platform;
  if (platform !== 'win32' && platform !== 'darwin' && platform !== 'linux') {
    return Promise.reject(new Error('Unsupported platform.'));
  }
  return Promise.resolve(spawnStructuredLineTransport(
    options.executablePath,
    ['--acp'],
    {
      platform,
      env: process.env,
      cwd: options.workingDirectory,
      requestTimeoutMs: 120_000,
      maxFrameBytes: 4 * 1024 * 1024,
      handleRequest: options.handleRequest
    }
  ));
}

async function containedPath(
  workspace: string,
  requestedPath: string,
  operation: 'read' | 'write'
): Promise<string> {
  if (!isAbsolute(requestedPath)) {
    throw new Error('The Gemini filesystem path must be absolute.');
  }
  const workspaceReal = await realpath(workspace);
  const candidate = resolve(requestedPath);
  const lexicalRelation = relative(workspaceReal, candidate);
  if (lexicalRelation.startsWith('..') || isAbsolute(lexicalRelation)) {
    throw new Error('Gemini filesystem access is outside the selected workspace.');
  }
  const anchor = operation === 'read'
    ? await realpath(candidate)
    : await realpath(dirname(candidate));
  const checked = operation === 'read' ? anchor : resolve(anchor, basename(candidate));
  const relation = relative(workspaceReal, checked);
  if (relation.startsWith('..') || isAbsolute(relation)) {
    throw new Error('Gemini filesystem access is outside the selected workspace.');
  }
  return checked;
}

export function createGeminiStructuredAdapter(
  context: StructuredAgentAdapterContext,
  options: CreateGeminiStructuredAdapterOptions = {}
): StructuredAgentAdapter {
  if (context.providerId !== 'gemini') {
    throw new Error('The Gemini adapter requires a Gemini context.');
  }
  const createTransport = options.createTransport ?? defaultTransportFactory;
  const resolveAuthenticationMethod = options.resolveAuthenticationMethod
    ?? (() => resolveGeminiAuthenticationMethod());
  const pendingPermissions = new Map<string, PendingPermission>();
  const initialEvents: StructuredAgentEventDraft[] = [];
  const postOpenEvents: StructuredAgentEventDraft[] = [];
  let transport: LineJsonRpcTransport | null = null;
  let nativeSessionId = context.launch.nativeSessionId;
  let currentTurnId: string | null = null;
  let turnNumber = 0;
  let opened = false;
  let activated = false;
  let closed = false;
  let initialPromptSent = false;
  let commands: StructuredAgentCommand[] = [];
  let providerCommands: StructuredAgentCommand[] = [];
  let modelCommand: StructuredAgentCommand | null = null;
  let modelConfigId: string | null = null;
  let usesLegacyModelMethod = false;

  const normalizeCommands = (value: unknown): StructuredAgentCommand[] => {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 256).flatMap((entry) => {
      const command = object(entry);
      if (
        command === null ||
        typeof command.name !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(command.name) ||
        typeof command.description !== 'string' ||
        command.description.trim() === ''
      ) return [];
      const input = object(command.input);
      if (command.name.toLocaleLowerCase() === 'model') return [];
      return [{
        id: `gemini:${command.name}`,
        name: `/${command.name}`,
        description: bounded(command.description, 512),
        inputHint: typeof input?.hint === 'string' && input.hint.trim() !== ''
          ? bounded(input.hint, 256)
          : null
      }];
    });
  };

  const publishCommands = (): void => {
    commands = [...(modelCommand === null ? [] : [modelCommand]), ...providerCommands];
    if (opened) context.callbacks.commandsChanged?.(commands);
  };

  const modelChoicesFromOptions = (
    value: unknown
  ): NonNullable<StructuredAgentCommand['choices']> => {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
      const candidate = object(entry);
      if (candidate === null) return [];
      if (Array.isArray(candidate.options)) return modelChoicesFromOptions(candidate.options);
      if (
        typeof candidate.value !== 'string' || candidate.value.trim() === '' ||
        typeof candidate.name !== 'string' || candidate.name.trim() === ''
      ) return [];
      return [{
        value: bounded(candidate.value.trim(), 512),
        label: bounded(candidate.name.trim(), 512),
        description: typeof candidate.description === 'string' && candidate.description.trim() !== ''
          ? bounded(candidate.description.trim(), 512)
          : null
      }];
    }).slice(0, 256);
  };

  const applySessionConfiguration = (value: unknown): void => {
    const response = object(value);
    const configOptions = Array.isArray(response?.configOptions) ? response.configOptions : [];
    const modelOption = configOptions.map(object).find((option) => (
      option !== null && option.type === 'select' &&
      (option.category === 'model' || option.id === 'model')
    ));
    if (
      modelOption !== undefined && modelOption !== null &&
      typeof modelOption.id === 'string' && modelOption.id.trim() !== '' &&
      typeof modelOption.currentValue === 'string' && modelOption.currentValue.trim() !== ''
    ) {
      const choices = modelChoicesFromOptions(modelOption.options);
      if (choices.length > 0) {
        modelConfigId = modelOption.id;
        usesLegacyModelMethod = false;
        modelCommand = {
          id: 'model',
          name: '/model',
          description: 'Choose the model for future turns.',
          descriptionKey: 'terminal.unified.commands.model',
          inputHint: '<model>',
          choices,
          selectedValue: choices.some(({ value }) => value === modelOption.currentValue)
            ? modelOption.currentValue
            : choices[0]!.value,
          selectionBehavior: 'execute'
        };
        publishCommands();
        return;
      }
    }

    const models = object(response?.models);
    const availableModels = Array.isArray(models?.availableModels) ? models.availableModels : [];
    const choices = availableModels.flatMap((entry) => {
      const candidate = object(entry);
      if (
        candidate === null ||
        typeof candidate.modelId !== 'string' || candidate.modelId.trim() === '' ||
        typeof candidate.name !== 'string' || candidate.name.trim() === ''
      ) return [];
      return [{
        value: bounded(candidate.modelId.trim(), 512),
        label: bounded(candidate.name.trim(), 512),
        description: typeof candidate.description === 'string' && candidate.description.trim() !== ''
          ? bounded(candidate.description.trim(), 512)
          : null
      }];
    }).slice(0, 256);
    if (choices.length > 0 && typeof models?.currentModelId === 'string') {
      modelConfigId = null;
      usesLegacyModelMethod = true;
      modelCommand = {
        id: 'model',
        name: '/model',
        description: 'Choose the model for future turns.',
        descriptionKey: 'terminal.unified.commands.model',
        inputHint: '<model>',
        choices,
        selectedValue: choices.some(({ value }) => value === models.currentModelId)
          ? models.currentModelId
          : choices[0]!.value,
        selectionBehavior: 'execute'
      };
      publishCommands();
    }
  };

  const deliver = (event: StructuredAgentEventDraft): void => {
    if (closed) return;
    if (!opened) initialEvents.push(event);
    else if (!activated) postOpenEvents.push(event);
    else context.callbacks.emit(event);
  };

  const ensureSession = (params: Record<string, unknown>): void => {
    if (params.sessionId !== nativeSessionId) {
      throw new Error('The Gemini request belongs to another session.');
    }
  };

  const handleRequest = async (request: JsonRpcProviderRequest): Promise<unknown> => {
    const params = object(request.params);
    if (params === null) throw new Error('The Gemini client request is invalid.');
    ensureSession(params);
    if (request.method === 'fs/read_text_file') {
      if (typeof params.path !== 'string') throw new Error('The Gemini file path is invalid.');
      const path = await containedPath(context.launch.workingDirectory, params.path, 'read');
      const content = await readFile(path, 'utf8');
      if (Buffer.byteLength(content) > 1024 * 1024) {
        throw new Error('The Gemini file exceeds Lumora’s read limit.');
      }
      const line = typeof params.line === 'number' ? Math.max(0, Math.floor(params.line)) : 0;
      const limit = typeof params.limit === 'number' ? Math.max(0, Math.floor(params.limit)) : undefined;
      const lines = content.split(/\r?\n/);
      return { content: lines.slice(line, limit === undefined ? undefined : line + limit).join('\n') };
    }
    if (request.method === 'fs/write_text_file') {
      if (typeof params.path !== 'string' || typeof params.content !== 'string') {
        throw new Error('The Gemini write request is invalid.');
      }
      if (Buffer.byteLength(params.content) > 1024 * 1024) {
        throw new Error('The Gemini write exceeds Lumora’s safety limit.');
      }
      const path = await containedPath(context.launch.workingDirectory, params.path, 'write');
      await writeFile(path, params.content, 'utf8');
      return {};
    }
    if (request.method !== 'session/request_permission') {
      throw new Error('The Gemini client method is not supported.');
    }
    const toolCall = object(params.toolCall);
    const toolCallId = typeof toolCall?.toolCallId === 'string' ? toolCall.toolCallId : null;
    const choices = Array.isArray(params.options)
      ? params.options.flatMap((value) => {
        const option = object(value);
        return typeof option?.optionId === 'string' && typeof option.kind === 'string'
          ? [{ optionId: option.optionId, kind: option.kind }]
          : [];
      })
      : [];
    if (toolCallId === null || choices.length === 0) {
      throw new Error('The Gemini permission request is invalid.');
    }
    const approvalId = `gemini-${toolCallId}`.slice(0, 256);
    const turnId = currentTurnId ?? `gemini-turn-${Math.max(1, turnNumber)}`;
    deliver({
      turnId,
      parentEventId: null,
      kind: 'approval.requested',
      payload: {
        approvalId,
        title: bounded(
          typeof toolCall?.title === 'string' ? toolCall.title : 'Gemini tool request',
          512
        ),
        detail: 'Gemini needs permission to continue this operation.',
        choices: ['allow_once', 'allow_session', 'deny']
      }
    });
    return new Promise((resolve) => {
      pendingPermissions.set(approvalId, { turnId, options: choices, resolve });
    });
  };

  const acceptNotification = (notification: JsonRpcNotification): void => {
    if (notification.method !== 'session/update') return;
    const params = object(notification.params);
    const update = object(params?.update);
    if (params?.sessionId !== nativeSessionId || update === null) return;
    const turnId = currentTurnId ?? `gemini-history-${initialEvents.length + 1}`;
    const kind = update.sessionUpdate;
    if (kind === 'available_commands_update') {
      providerCommands = normalizeCommands(update.availableCommands);
      publishCommands();
      return;
    }
    if (kind === 'config_option_update') {
      applySessionConfiguration({ configOptions: update.configOptions });
      return;
    }
    const content = object(update.content);
    if (
      (kind === 'agent_message_chunk' || kind === 'user_message_chunk') &&
      content?.type === 'text' && typeof content.text === 'string' && content.text.length > 0
    ) {
      deliver({
        turnId,
        parentEventId: null,
        kind: kind === 'agent_message_chunk'
          ? (opened ? 'assistant.delta' : 'assistant.message')
          : 'user.message',
        payload: { text: bounded(content.text) }
      });
      return;
    }
    if (
      kind === 'agent_thought_chunk' && content?.type === 'text' &&
      typeof content.text === 'string' && content.text.length > 0
    ) {
      deliver({
        turnId, parentEventId: null, kind: 'reasoning.summary',
        payload: { text: bounded(content.text) }
      });
      return;
    }
    if (kind === 'tool_call' && typeof update.toolCallId === 'string') {
      deliver({
        turnId,
        parentEventId: null,
        kind: update.kind === 'execute' ? 'command.started' : 'tool.started',
        payload: {
          activityId: update.toolCallId,
          title: bounded(typeof update.title === 'string' ? update.title : 'Tool', 512),
          detail: null
        }
      });
      return;
    }
    if (kind === 'tool_call_update' && typeof update.toolCallId === 'string') {
      const state = update.status === 'failed' ? 'failed'
        : update.status === 'completed' ? 'completed'
          : 'running';
      deliver({
        turnId,
        parentEventId: null,
        kind: update.kind === 'execute' ? 'command.updated' : 'tool.updated',
        payload: {
          activityId: update.toolCallId,
          title: typeof update.title === 'string' ? bounded(update.title, 512) : undefined,
          status: state,
          detail: null
        }
      });
      const contents = Array.isArray(update.content) ? update.content : [];
      for (const entry of contents) {
        const diff = object(entry);
        if (diff?.type !== 'diff' || typeof diff.path !== 'string') continue;
        deliver({
          turnId,
          parentEventId: null,
          kind: 'file.changed',
          payload: {
            activityId: `${update.toolCallId}:file`,
            title: 'File change',
            pathLabel: bounded(diff.path, 4_096),
            change: diff.oldText === null ? 'created' : 'updated'
          }
        });
        if (
          (diff.oldText === null || typeof diff.oldText === 'string') &&
          typeof diff.newText === 'string'
        ) {
          deliver({
            turnId,
            parentEventId: null,
            kind: 'diff.updated',
            payload: {
              diffId: `${turnId}:${update.toolCallId}`.slice(0, 256),
              files: [createFullTextUnifiedDiff(
                bounded(diff.path, 4_096),
                diff.oldText,
                diff.newText
              )]
            }
          });
        }
      }
      return;
    }
    if (kind === 'plan' && Array.isArray(update.entries)) {
      deliver({
        turnId,
        parentEventId: null,
        kind: 'plan.updated',
        payload: {
          items: update.entries.slice(0, 100).flatMap((entry, index) => {
            const item = object(entry);
            if (typeof item?.content !== 'string') return [];
            return [{
              id: `${turnId}:${index}`,
              text: bounded(item.content, 2_048),
              status: item.status === 'completed' ? 'completed' as const
                : item.status === 'in_progress' ? 'in_progress' as const
                  : 'pending' as const
            }];
          })
        }
      });
    }
  };

  const runPrompt = async (text: string, attachmentTokens: readonly string[]): Promise<void> => {
    if (transport === null || nativeSessionId === null) throw new Error('Gemini is not ready.');
    if (attachmentTokens.length > 0) {
      throw new Error('Gemini structured attachments are not available yet.');
    }
    if (text.trim().length === 0) return;
    if (currentTurnId !== null) throw new Error('Gemini is already processing a prompt.');
    turnNumber += 1;
    const turnId = `gemini-turn-${turnNumber}`;
    currentTurnId = turnId;
    deliver({
      turnId, parentEventId: null, kind: 'turn.started',
      payload: { state: 'running', message: null }
    });
    deliver({
      turnId, parentEventId: null, kind: 'user.message',
      payload: { text: bounded(text) }
    });
    try {
      const response = PromptResponseSchema.parse(await transport.request('session/prompt', {
        sessionId: nativeSessionId,
        prompt: [{ type: 'text', text }]
      }));
      if (response.usage) {
        deliver({
          turnId,
          parentEventId: null,
          kind: 'usage.updated',
          payload: {
            inputTokens: response.usage.inputTokens,
            cachedInputTokens: response.usage.cachedReadTokens ?? null,
            outputTokens: response.usage.outputTokens,
            totalTokens: response.usage.totalTokens
          }
        });
      }
      deliver({
        turnId,
        parentEventId: null,
        kind: 'turn.completed',
        payload: {
          state: response.stopReason === 'cancelled' ? 'cancelled'
            : response.stopReason === 'end_turn' ? 'completed'
              : 'failed',
          message: null
        }
      });
    } catch {
      deliver({
        turnId,
        parentEventId: null,
        kind: 'turn.completed',
        payload: { state: 'failed', message: 'Gemini could not complete this turn.' }
      });
    } finally {
      if (currentTurnId === turnId) currentTurnId = null;
    }
  };

  return {
    async open() {
      transport = await createTransport({
        executablePath: context.launch.executablePath,
        workingDirectory: context.launch.workingDirectory,
        handleRequest
      });
      transport.onNotification(acceptNotification);
      transport.onExit((error) => {
        if (!closed) context.callbacks.exited(error);
      });
      const initialized = InitializeSchema.parse(await transport.request('initialize', {
        protocolVersion: 1,
        clientInfo: {
          name: 'lumora',
          title: 'Lumora',
          version: context.clientVersion ?? 'unknown'
        },
        clientCapabilities: {
          auth: { terminal: false },
          fs: { readTextFile: true, writeTextFile: true },
          terminal: false
        }
      }));
      const authenticationMethod = await resolveAuthenticationMethod();
      if (authenticationMethod === null) {
        throw new Error('Gemini has no configured authentication method.');
      }
      if (!initialized.authMethods.some(({ id }) => id === authenticationMethod)) {
        throw new Error('Gemini does not support the configured authentication method.');
      }
      await transport.request('authenticate', {
        methodId: authenticationMethod
      });
      let sessionResponse: z.infer<typeof SessionResponseSchema>;
      if (context.launch.request.strategy === 'new') {
        sessionResponse = SessionResponseSchema.parse(await transport.request('session/new', {
          cwd: context.launch.workingDirectory,
          mcpServers: []
        }));
        if (sessionResponse.sessionId === undefined) {
          throw new Error('Gemini did not return a native session id.');
        }
        nativeSessionId = sessionResponse.sessionId;
      } else {
        if (!initialized.agentCapabilities.loadSession || nativeSessionId === null) {
          throw new Error('Gemini cannot load this session.');
        }
        sessionResponse = SessionResponseSchema.parse(await transport.request('session/load', {
          sessionId: nativeSessionId,
          cwd: context.launch.workingDirectory,
          mcpServers: []
        }));
      }
      applySessionConfiguration(sessionResponse);
      opened = true;
      return {
        nativeSessionId,
        ...(commands.length === 0 ? {} : { commands }),
        initialEvents: initialEvents.splice(0)
      };
    },

    async activate() {
      if (!activated) {
        activated = true;
        for (const event of postOpenEvents.splice(0)) context.callbacks.emit(event);
      }
      if (initialPromptSent) return;
      initialPromptSent = true;
      if (context.launch.request.startPrompt.trim().length > 0) {
        void runPrompt(context.launch.request.startPrompt, []);
      }
    },

    async dispatch(action: StructuredAgentAction) {
      if (action.kind === 'session.details.refresh') return;
      if (action.kind === 'command.execute') {
        const command = commands.find(({ id }) => id === action.commandId);
        if (command === undefined) throw new Error('The Gemini command is not available.');
        if (command.id === 'model') {
          if (transport === null || nativeSessionId === null) {
            throw new Error('Gemini is not ready.');
          }
          const model = command.choices?.find(({ value }) => value === action.argument.trim());
          if (model === undefined) throw new Error('The Gemini model is not available.');
          if (modelConfigId !== null) {
            const response = await transport.request('session/set_config_option', {
              sessionId: nativeSessionId,
              configId: modelConfigId,
              value: model.value
            });
            applySessionConfiguration(response);
          } else if (usesLegacyModelMethod) {
            await transport.request('session/set_model', {
              sessionId: nativeSessionId,
              modelId: model.value
            });
            modelCommand = { ...command, selectedValue: model.value };
            publishCommands();
          } else {
            throw new Error('Gemini model selection is unavailable.');
          }
          return;
        }
        void runPrompt(
          `${command.name}${action.argument.trim() === '' ? '' : ` ${action.argument.trim()}`}`,
          []
        );
        return;
      }
      if (action.kind === 'prompt.submit') {
        if (action.text.trim().length === 0) return;
        if (action.attachmentTokens.length > 0) {
          throw new Error('Gemini structured attachments are not available yet.');
        }
        if (currentTurnId !== null) {
          throw new Error('Gemini is already processing a prompt.');
        }
        void runPrompt(action.text, action.attachmentTokens);
        return;
      }
      if (action.kind === 'turn.cancel') {
        if (transport !== null && nativeSessionId !== null && currentTurnId !== null) {
          await transport.notify('session/cancel', { sessionId: nativeSessionId });
        }
        return;
      }
      const pending = pendingPermissions.get(action.approvalId);
      if (pending === undefined) throw new Error('The Gemini permission is no longer pending.');
      pendingPermissions.delete(action.approvalId);
      const desiredKind = action.decision === 'allow_once' ? 'allow_once'
        : action.decision === 'allow_session' ? 'allow_always'
          : 'reject_once';
      const selected = pending.options.find(({ kind }) => kind === desiredKind)
        ?? pending.options.find(({ kind }) => action.decision === 'deny'
          ? kind.startsWith('reject')
          : kind.startsWith('allow'));
      pending.resolve(selected === undefined
        ? { outcome: { outcome: 'cancelled' } }
        : { outcome: { outcome: 'selected', optionId: selected.optionId } });
      deliver({
        turnId: pending.turnId,
        parentEventId: null,
        kind: 'approval.resolved',
        payload: { approvalId: action.approvalId, decision: action.decision }
      });
    },

    async close() {
      if (closed) return;
      closed = true;
      for (const pending of pendingPermissions.values()) {
        pending.resolve({ outcome: { outcome: 'cancelled' } });
      }
      pendingPermissions.clear();
      await transport?.close();
      transport = null;
    }
  };
}
