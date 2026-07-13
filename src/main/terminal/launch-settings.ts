import type {
  LaunchSettingSource,
  LaunchSettingsLayer,
  ProviderId,
  ResolvedLaunchSetting,
  TerminalProfile
} from '../../shared/contracts';

interface SettingCandidate {
  value: string | null;
  source: LaunchSettingSource;
}

export interface ResolvedLaunchSettings {
  command: string | null;
  profile: TerminalProfile | null;
  configuration: [ResolvedLaunchSetting, ResolvedLaunchSetting];
  warnings: string[];
}

interface ResolveLaunchSettingsInput {
  provider: ProviderId;
  workspaceId: string;
  sessionId: string | null;
  requestedTerminalProfileId: string | null;
  layers: readonly LaunchSettingsLayer[];
  profiles: readonly TerminalProfile[];
}

function sourceFor(layer: LaunchSettingsLayer): LaunchSettingSource {
  return { scope: layer.scope, targetId: layer.targetId };
}

function applicableLayers(
  input: ResolveLaunchSettingsInput
): LaunchSettingsLayer[] {
  const targets: Array<[LaunchSettingsLayer['scope'], string | null]> = [
    ['global', 'global'],
    ['provider', input.provider],
    ['workspace', input.workspaceId],
    ['session', input.sessionId]
  ];
  return targets.flatMap(([scope, targetId]) => {
    if (targetId === null) return [];
    const layer = input.layers.find(
      (candidate) =>
        candidate.scope === scope && candidate.targetId === targetId
    );
    return layer === undefined ? [] : [layer];
  });
}

function ownCommand(
  layer: LaunchSettingsLayer,
  provider: ProviderId
): { present: boolean; value: string | null } {
  const commands = layer.settings.providerCommands;
  if (
    commands === undefined ||
    !Object.prototype.hasOwnProperty.call(commands, provider) ||
    commands[provider] === undefined
  ) {
    return { present: false, value: null };
  }
  return { present: true, value: commands[provider] ?? null };
}

function availableProfile(
  profiles: readonly TerminalProfile[],
  id: string
): TerminalProfile | null {
  return (
    profiles.find((profile) => profile.id === id && profile.available) ?? null
  );
}

function recommendedProfile(
  profiles: readonly TerminalProfile[]
): TerminalProfile | null {
  return (
    profiles.find((profile) => profile.available && profile.recommended) ??
    profiles.find((profile) => profile.available) ??
    null
  );
}

export function resolveLaunchSettings(
  input: ResolveLaunchSettingsInput
): ResolvedLaunchSettings {
  const layers = applicableLayers(input);
  let command: SettingCandidate = {
    value: null,
    source: { scope: 'default', targetId: null }
  };
  const commandShadowed: SettingCandidate[] = [];
  for (const layer of layers) {
    const candidate = ownCommand(layer, input.provider);
    if (!candidate.present) continue;
    commandShadowed.push(command);
    command = { value: candidate.value, source: sourceFor(layer) };
  }

  const recommended = recommendedProfile(input.profiles);
  let profile: TerminalProfile | null = recommended;
  let terminal: SettingCandidate = {
    value: recommended?.id ?? null,
    source: { scope: 'default', targetId: null }
  };
  const terminalShadowed: SettingCandidate[] = [];
  const terminalWarnings: string[] = [];

  for (const layer of layers) {
    if (layer.settings.terminalProfileId === undefined) continue;
    const configuredId = layer.settings.terminalProfileId;
    const candidate =
      configuredId === null
        ? recommended
        : availableProfile(input.profiles, configuredId);
    if (candidate === null) {
      terminalWarnings.push(
        `The ${layer.scope} terminal profile is unavailable; using the lower-precedence value.`
      );
      continue;
    }
    terminalShadowed.push(terminal);
    profile = candidate;
    terminal = { value: candidate.id, source: sourceFor(layer) };
  }

  if (input.requestedTerminalProfileId !== null) {
    terminalShadowed.push(terminal);
    profile = availableProfile(
      input.profiles,
      input.requestedTerminalProfileId
    );
    terminal = {
      value: input.requestedTerminalProfileId,
      source: { scope: 'launch', targetId: null }
    };
    if (profile === null) {
      terminalWarnings.push(
        'The launch terminal profile is unavailable.'
      );
    }
  }

  const configuration: [ResolvedLaunchSetting, ResolvedLaunchSetting] = [
    {
      field: 'providerCommand',
      value: command.value,
      winningSource: command.source,
      shadowed: commandShadowed,
      mergeStrategy: 'replace',
      warnings: [],
      sensitive: false
    },
    {
      field: 'terminalProfile',
      value: terminal.value,
      winningSource: terminal.source,
      shadowed: terminalShadowed,
      mergeStrategy: 'replace',
      warnings: terminalWarnings,
      sensitive: false
    }
  ];

  return {
    command: command.value,
    profile,
    configuration,
    warnings: terminalWarnings
  };
}
