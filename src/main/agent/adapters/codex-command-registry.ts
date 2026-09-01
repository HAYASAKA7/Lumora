import { z } from 'zod';

import type { StructuredAgentCommand } from '../../../shared/agent/contracts';

type Request = (method: string, params?: unknown) => Promise<unknown>;

const ModelListSchema = z.object({
  data: z.array(z.object({
    model: z.string().trim().min(1).max(256),
    displayName: z.string().trim().min(1).max(512),
    description: z.string().max(512).default(''),
    supportedReasoningEfforts: z.array(z.object({
      reasoningEffort: z.string().trim().min(1).max(128),
      description: z.string().max(512).default('')
    }).passthrough()).max(32).default([]),
    defaultReasoningEffort: z.string().trim().min(1).max(128),
    supportsPersonality: z.boolean().default(false),
    serviceTiers: z.array(z.object({
      id: z.string().trim().min(1).max(128),
      name: z.string().trim().min(1).max(256),
      description: z.string().max(512).default('')
    }).passthrough()).max(16).default([]),
    defaultServiceTier: z.string().trim().min(1).max(128).nullable().default(null),
    isDefault: z.boolean().default(false)
  }).passthrough()).max(100)
}).passthrough();

const PermissionListSchema = z.object({
  data: z.array(z.object({
    id: z.string().trim().min(1).max(256),
    description: z.string().max(512).nullable(),
    allowed: z.boolean()
  }).passthrough()).max(100)
}).passthrough();

const SkillsListSchema = z.object({
  data: z.array(z.object({
    skills: z.array(z.object({
      name: z.string().trim().min(1).max(256),
      description: z.string().max(512),
      path: z.string().trim().min(1).max(8_192),
      enabled: z.boolean()
    }).passthrough()).max(256)
  }).passthrough()).max(16)
}).passthrough();

export const CodexMcpStatusListSchema = z.object({
  data: z.array(z.object({
    name: z.string().trim().min(1).max(256),
    runtimeStatus: z.string().trim().min(1).max(128).nullable(),
    authStatus: z.string().trim().min(1).max(128)
  }).passthrough()).max(100)
}).passthrough();

export interface CodexModelOption {
  model: string;
  displayName: string;
  description: string;
  defaultEffort: string;
  isDefault: boolean;
  supportsPersonality: boolean;
  serviceTiers: readonly {
    id: string;
    name: string;
    description: string;
  }[];
  defaultServiceTier: string | null;
  efforts: readonly {
    value: string;
    description: string;
  }[];
}

export interface CodexSkillOption {
  name: string;
  description: string;
  path: string;
}

export interface CodexCommandDiscovery {
  models: readonly CodexModelOption[];
  permissionProfiles: readonly {
    id: string;
    description: string | null;
  }[];
  skills: readonly CodexSkillOption[];
}

async function safeRequest<T>(
  request: Request,
  method: string,
  params: unknown,
  schema: z.ZodType<T>
): Promise<T | null> {
  try {
    const parsed = schema.safeParse(await request(method, params));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function discoverCodexCommands(
  request: Request,
  workingDirectory: string
): Promise<CodexCommandDiscovery> {
  const [models, permissions, skills] = await Promise.all([
    safeRequest(request, 'model/list', {
      limit: 100,
      includeHidden: false
    }, ModelListSchema),
    safeRequest(request, 'permissionProfile/list', {
      limit: 100,
      cwd: workingDirectory
    }, PermissionListSchema),
    safeRequest(request, 'skills/list', {
      cwds: [workingDirectory],
      forceReload: false
    }, SkillsListSchema)
  ]);
  return {
    models: (models?.data ?? []).map((model) => ({
      model: model.model,
      displayName: model.displayName,
      description: model.description,
      defaultEffort: model.defaultReasoningEffort,
      isDefault: model.isDefault,
      supportsPersonality: model.supportsPersonality,
      serviceTiers: model.serviceTiers,
      defaultServiceTier: model.defaultServiceTier,
      efforts: model.supportedReasoningEfforts.map((effort) => ({
        value: effort.reasoningEffort,
        description: effort.description
      }))
    })),
    permissionProfiles: (permissions?.data ?? [])
      .filter(({ allowed }) => allowed)
      .map(({ id, description }) => ({ id, description })),
    skills: (skills?.data ?? [])
      .flatMap(({ skills: entries }) => entries)
      .filter(({ enabled }) => enabled)
      .map(({ name, description, path }) => ({ name, description, path }))
  };
}

function description(value: string): string | null {
  const normalized = value.trim();
  return normalized === '' ? null : normalized;
}

export function buildCodexCommands(
  discovery: CodexCommandDiscovery,
  selectedModel: string | null
): StructuredAgentCommand[] {
  const model = selectedModel === null
    ? discovery.models[0] ?? null
    : discovery.models.find((candidate) => candidate.model === selectedModel) ?? null;
  const commands: StructuredAgentCommand[] = [];
  if (discovery.models.length > 0) {
    commands.push({
      id: 'model',
      name: '/model',
      description: 'Choose the model for future turns.',
      descriptionKey: 'terminal.unified.commands.model',
      inputHint: '<model>',
      choices: discovery.models.map((candidate) => ({
        value: candidate.model,
        label: candidate.displayName,
        description: description(candidate.description)
      })),
      ...(model === null ? {} : { selectedValue: model.model }),
      selectionBehavior: 'execute'
    });
  }
  if (model !== null && model.efforts.length > 0) {
    commands.push({
      id: 'effort',
      name: '/reasoning',
      description: 'Choose the reasoning effort for future turns.',
      descriptionKey: 'terminal.unified.commands.effort',
      inputHint: '<effort>',
      choices: model.efforts.map((effort) => ({
        value: effort.value,
        label: effort.value,
        description: description(effort.description)
      })),
      selectionBehavior: 'execute'
    });
  }
  if (model?.serviceTiers.some(({ id }) => id === 'fast' || id === 'priority')) {
    commands.push({
      id: 'fast', name: '/fast',
      description: 'Toggle Fast mode for future turns.',
      descriptionKey: 'terminal.unified.commands.fast', inputHint: null
    });
  }
  if (model?.supportsPersonality === true) {
    commands.push({
      id: 'personality', name: '/personality',
      description: 'Choose how Codex communicates.',
      descriptionKey: 'terminal.unified.commands.personality',
      inputHint: '<style>',
      choices: [
        {
          value: 'friendly', label: 'Friendly', description: null,
          labelKey: 'terminal.unified.command-values.friendly'
        },
        {
          value: 'pragmatic', label: 'Pragmatic', description: null,
          labelKey: 'terminal.unified.command-values.pragmatic'
        },
        {
          value: 'none', label: 'None', description: null,
          labelKey: 'terminal.unified.command-values.none'
        }
      ],
      selectionBehavior: 'execute'
    });
  }
  commands.push({
    id: 'mode', name: '/plan',
    description: 'Switch to plan mode, optionally with a planning request.',
    descriptionKey: 'terminal.unified.commands.plan', inputHint: '[request]'
  });
  commands.push(
    {
      id: 'review', name: '/review',
      description: 'Review the current workspace.',
      descriptionKey: 'terminal.unified.commands.review', inputHint: '[instructions]'
    },
    {
      id: 'compact', name: '/compact',
      description: 'Compact the current context.',
      descriptionKey: 'terminal.unified.commands.compact', inputHint: null
    },
    {
      id: 'diff', name: '/diff',
      description: 'Show the current Git diff for the workspace.',
      descriptionKey: 'terminal.unified.commands.diff', inputHint: null
    },
    {
      id: 'copy', name: '/copy',
      description: 'Copy the latest assistant response.',
      descriptionKey: 'terminal.unified.commands.copy', inputHint: null
    }
  );
  if (discovery.permissionProfiles.length > 0) {
    commands.push({
      id: 'permissions',
      name: '/permissions',
      description: 'Choose the permission profile for future turns.',
      descriptionKey: 'terminal.unified.commands.permissions',
      inputHint: '<profile>',
      choices: discovery.permissionProfiles.map((profile) => ({
        value: profile.id,
        label: profile.id,
        description: profile.description
      })),
      selectionBehavior: 'execute'
    });
  }
  commands.push(
    {
      id: 'goal', name: '/goal',
      description: 'View, set, pause, resume, or clear the current goal.',
      descriptionKey: 'terminal.unified.commands.goal',
      inputHint: '[objective|pause|resume|clear]'
    },
    {
      id: 'memories', name: '/memories',
      description: 'Choose whether this session can use memories.',
      descriptionKey: 'terminal.unified.commands.memories',
      inputHint: '<enabled|disabled>',
      choices: [
        {
          value: 'enabled', label: 'Enabled', description: null,
          labelKey: 'terminal.unified.command-values.enabled'
        },
        {
          value: 'disabled', label: 'Disabled', description: null,
          labelKey: 'terminal.unified.command-values.disabled'
        }
      ],
      selectionBehavior: 'execute'
    }
  );
  commands.push({
    id: 'skills', name: '/skills',
    description: 'Show the enabled skills available to this workspace.',
    descriptionKey: 'terminal.unified.commands.skills', inputHint: null
  });
  if (discovery.skills.length > 0) {
    commands.push({
      id: 'skill',
      name: '/skill',
      description: 'Use a skill for the next task.',
      descriptionKey: 'terminal.unified.commands.skill',
      inputHint: '<skill> [task]',
      choices: discovery.skills.map((skill) => ({
        value: skill.name,
        label: skill.name,
        description: description(skill.description)
      })),
      selectionBehavior: 'continue'
    });
  }
  commands.push(
    {
      id: 'mcp', name: '/mcp',
      description: 'Show the MCP servers available to this session.',
      descriptionKey: 'terminal.unified.commands.mcp', inputHint: null
    },
    {
      id: 'apps', name: '/apps',
      description: 'Show apps available to this session.',
      descriptionKey: 'terminal.unified.commands.apps', inputHint: null
    },
    {
      id: 'plugins', name: '/plugins',
      description: 'Show installed and available Codex plugins.',
      descriptionKey: 'terminal.unified.commands.plugins', inputHint: null
    },
    {
      id: 'hooks', name: '/hooks',
      description: 'Show lifecycle hooks for this workspace.',
      descriptionKey: 'terminal.unified.commands.hooks', inputHint: null
    },
    {
      id: 'ps', name: '/ps',
      description: 'Show background terminals started by this session.',
      descriptionKey: 'terminal.unified.commands.ps', inputHint: null
    },
    {
      id: 'stop', name: '/stop',
      description: 'Stop all background terminals started by this session.',
      descriptionKey: 'terminal.unified.commands.stop', inputHint: null
    },
    {
      id: 'status', name: '/status',
      description: 'Show the current session configuration and limits.',
      descriptionKey: 'terminal.unified.commands.status', inputHint: null
    },
    {
      id: 'usage', name: '/usage',
      description: 'Show Codex account token usage.',
      descriptionKey: 'terminal.unified.commands.usage', inputHint: null
    },
    {
      id: 'rename', name: '/rename',
      description: 'Rename the native Codex session.',
      descriptionKey: 'terminal.unified.commands.rename', inputHint: '<name>'
    }
  );
  return commands;
}
