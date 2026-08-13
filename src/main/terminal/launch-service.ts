import { createHmac, randomUUID } from 'node:crypto';

import {
  LaunchPrepareRequestSchema,
  LaunchPreviewSchema,
  type LaunchPrepareRequest,
  type LaunchPreview,
  type LaunchSettingsLayer,
  type ProviderId,
  type ProviderScanResult,
  type ResolvedLaunchSetting,
  type SystemInfo,
  type TerminalProfile,
  type WorkspaceTrustDecision
} from '../../shared/contracts';
import {
  hasSessionHandoffDestinationSupport,
  hasSessionHandoffSourceSupport,
  providerDefinition,
  supportsNativeForkVersion
} from '../../shared/provider-definitions';
import type { HandoffPlan, HandoffService } from '../handoff/handoff-service';
import {
  buildManagedHandoffArguments,
  buildNewArguments
} from '../providers/launch-command';
import type {
  ReadyProviderInstallation,
  SessionCatalogAdapter,
  SessionCatalogRegistry
} from '../providers/session-catalog-adapter';
import type { WorkspaceLaunchInfo } from '../storage/terminal-repository';
import type { SessionLaunchInfo } from '../storage/terminal-repository';
import { resolveLaunchSettings } from './launch-settings';

type Environment = Readonly<Record<string, string | undefined>>;

interface LaunchRepository {
  getWorkspace(workspaceId: string): WorkspaceLaunchInfo | null;
  getProfile(profileId: string): TerminalProfile | null;
  getSession(sessionId: string): SessionLaunchInfo | null;
  getGeneralSettings(): import('../../shared/contracts').GeneralSettings;
  listCurrentSessionSourceKeys(sessionId: string): string[];
  listProfiles(): TerminalProfile[];
  listLaunchSettingsLayers(): LaunchSettingsLayer[];
  isWorkspaceTrusted(workspaceId: string, canonicalPath: string): boolean;
  trustWorkspace(
    workspaceId: string,
    canonicalPath: string,
    timestamp: string
  ): WorkspaceTrustDecision;
}

interface LaunchServiceDependencies {
  repository: LaunchRepository;
  sessionCatalogRegistry: SessionCatalogRegistry;
  scanProviders(): Promise<ProviderScanResult>;
  isExecutablePath(path: string): Promise<boolean>;
  captureSessionBaseline(
    provider: ProviderId,
    workspaceId: string
  ): Promise<readonly string[]>;
  handoffService: Pick<HandoffService, 'reserve' | 'materialize'>;
  platform: SystemInfo['platform'];
  env: Environment;
  buildEnvironment?(
    env: Environment,
    profile: TerminalProfile
  ): Record<string, string | undefined>;
  clock?: () => Date;
  createToken?: () => string;
}

export interface LaunchSpec {
  displayName: string;
  strategy: 'new' | 'resume' | 'fork';
  sessionId: string | null;
  nativeSessionId: string | null;
  reconciliationBaselineNativeIds: string[] | null;
  provider: ProviderId;
  workspaceId: string;
  executablePath: string;
  args: string[];
  command: string | null;
  workingDirectory: string;
  environment: Record<string, string | undefined>;
  terminalProfile: TerminalProfile;
  configuration: [ResolvedLaunchSetting, ResolvedLaunchSetting];
  launchHash: string;
  cols: number;
  rows: number;
  createdAt: string;
  handoff?: {
    plan: HandoffPlan;
    sourceKeys: string[];
    sourceExecutablePath: string;
  } | null;
  fork?: {
    sourceSessionId: string;
    sourceNativeSessionId: string;
    startPrompt: string;
  } | null;
}

interface PreparedLaunch {
  spec: LaunchSpec;
  expiresAtMs: number;
  requestedTerminalProfileId: string | null;
  startPrompt: string;
}

export type TerminalLaunchErrorCode =
  | 'WORKSPACE_UNAVAILABLE'
  | 'WORKSPACE_NOT_TRUSTED'
  | 'SESSION_UNAVAILABLE'
  | 'TERMINAL_PROFILE_UNAVAILABLE'
  | 'PROVIDER_UNAVAILABLE'
  | 'CROSS_AGENT_DISABLED'
  | 'NATIVE_FORK_UNAVAILABLE'
  | 'HANDOFF_PREPARATION_FAILED'
  | 'LAUNCH_TOKEN_INVALID'
  | 'LAUNCH_TOKEN_EXPIRED';

const ERROR_MESSAGES: Record<TerminalLaunchErrorCode, string> = {
  WORKSPACE_UNAVAILABLE: 'The selected workspace is unavailable.',
  WORKSPACE_NOT_TRUSTED: 'Trust this workspace before starting a provider.',
  SESSION_UNAVAILABLE: 'The selected session is unavailable.',
  TERMINAL_PROFILE_UNAVAILABLE: 'The selected terminal profile is unavailable.',
  PROVIDER_UNAVAILABLE: 'The selected provider is unavailable.',
  CROSS_AGENT_DISABLED: 'Cross-agent handoff is disabled.',
  NATIVE_FORK_UNAVAILABLE:
    'The selected provider does not support native session fork.',
  HANDOFF_PREPARATION_FAILED: 'Lumora could not prepare the session handoff.',
  LAUNCH_TOKEN_INVALID: 'The launch preview is no longer valid.',
  LAUNCH_TOKEN_EXPIRED: 'The launch preview expired. Prepare it again.'
};

export class TerminalLaunchError extends Error {
  constructor(readonly code: TerminalLaunchErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'TerminalLaunchError';
  }
}

function environmentWithProfile(
  env: Environment,
  profile: TerminalProfile
): Record<string, string | undefined> {
  return { ...env, SHELL: profile.executablePath };
}

function launchHash(
  value: Omit<LaunchSpec, 'launchHash' | 'createdAt'>,
  launchToken: string
): string {
  return createHmac('sha256', launchToken)
    .update(
      JSON.stringify({
        strategy: value.strategy,
        provider: value.provider,
        workspaceId: value.workspaceId,
        sessionId: value.sessionId,
        nativeSessionId: value.nativeSessionId,
        executablePath: value.executablePath,
        args: value.args,
        command: value.command,
        workingDirectory: value.workingDirectory,
        terminalProfileId: value.terminalProfile.id,
        terminalProfilePath: value.terminalProfile.executablePath,
        environmentNames: Object.keys(value.environment).sort(),
        cols: value.cols,
        rows: value.rows,
        handoff: value.handoff === undefined || value.handoff === null
          ? null
          : {
              id: value.handoff.plan.id,
              sourceSessionId: value.handoff.plan.sourceSessionId,
              sourceNativeId: value.handoff.plan.sourceNativeId,
              sourceProvider: value.handoff.plan.sourceProvider,
              destinationProvider: value.handoff.plan.destinationProvider,
              retentionDays: value.handoff.plan.retentionDays,
              sourceKeys: value.handoff.sourceKeys,
              sourceExecutablePath: value.handoff.sourceExecutablePath
            },
        fork:
          value.fork === undefined || value.fork === null
            ? null
            : {
                sourceSessionId: value.fork.sourceSessionId,
                sourceNativeSessionId: value.fork.sourceNativeSessionId,
                startPrompt: value.fork.startPrompt
              }
      })
    )
    .digest('hex');
}

function normalizeSessionBaseline(values: readonly string[]): string[] {
  if (values.length > 25_000) {
    throw new Error('The session baseline is too large.');
  }
  const normalized = values.map((value) => value.trim());
  if (normalized.some((value) => value.length === 0 || value.length > 256)) {
    throw new Error('The session baseline contains an invalid identity.');
  }
  return [...new Set(normalized)].sort();
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isAdapterCompatible(
  adapter: SessionCatalogAdapter,
  installation: ReadyProviderInstallation
): boolean {
  try {
    return adapter.validateCompatibility(installation).compatible;
  } catch {
    return false;
  }
}

const MAX_RUNTIME_DISPLAY_NAME_LENGTH = 256;

function forkDisplayName(title: string): string {
  const prefix = 'Fork of ';
  return `${prefix}${title.slice(0, MAX_RUNTIME_DISPLAY_NAME_LENGTH - prefix.length)}`;
}

export class LaunchService {
  private readonly prepared = new Map<string, PreparedLaunch>();
  private readonly expiryTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly clock: () => Date;
  private readonly createToken: () => string;
  private prepareGeneration = 0;

  constructor(private readonly dependencies: LaunchServiceDependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
    this.createToken = dependencies.createToken ?? randomUUID;
  }

  async prepare(value: LaunchPrepareRequest): Promise<LaunchPreview> {
    const request = LaunchPrepareRequestSchema.parse(value);
    const generation = ++this.prepareGeneration;
    this.clearPrepared();
    const token = this.createToken();
    let provider: ProviderId;
    let workspaceId: string;
    let sessionId: string | null;
    let nativeSessionId: string | null;
    let displayName: string;
    let args: string[];
    let handoff: LaunchSpec['handoff'] = null;
    let fork: LaunchSpec['fork'] = null;
    let sourceSession: SessionLaunchInfo | null = null;
    if (request.strategy === 'new') {
      provider = request.provider;
      workspaceId = request.workspaceId;
      sessionId = null;
      nativeSessionId = null;
      displayName = `New ${providerDefinition(provider).displayName} session`;
      args = buildNewArguments(provider, request.startPrompt);
    } else {
      const session = this.dependencies.repository.getSession(request.sessionId);
      if (session === null || session.sourceFreshness !== 'current') {
        throw new TerminalLaunchError('SESSION_UNAVAILABLE');
      }
      const destinationProvider =
        request.strategy === 'resume'
          ? request.provider ?? session.provider
          : session.provider;
      provider = destinationProvider;
      workspaceId = session.workspaceId;
      displayName = session.title;
      if (request.strategy === 'fork') {
        const settings = this.dependencies.repository.getGeneralSettings();
        const adapter = this.dependencies.sessionCatalogRegistry.get(provider);
        if (!settings.enabledProviders.includes(provider)) {
          throw new TerminalLaunchError('PROVIDER_UNAVAILABLE');
        }
        if (adapter?.buildForkArguments === undefined) {
          throw new TerminalLaunchError('NATIVE_FORK_UNAVAILABLE');
        }
        sessionId = null;
        nativeSessionId = null;
        displayName = forkDisplayName(session.title);
        args = [...adapter.buildForkArguments(session.nativeId, request.startPrompt)];
        fork = {
          sourceSessionId: session.id,
          sourceNativeSessionId: session.nativeId,
          startPrompt: request.startPrompt
        };
      } else if (destinationProvider === session.provider) {
        sessionId = session.id;
        nativeSessionId = session.nativeId;
        const adapter = this.dependencies.sessionCatalogRegistry.get(provider);
        if (adapter === null) {
          throw new TerminalLaunchError('SESSION_UNAVAILABLE');
        }
        args = [...adapter.buildResumeArguments(nativeSessionId, request.startPrompt)];
      } else {
        const settings = this.dependencies.repository.getGeneralSettings();
        if (!settings.crossAgentWorkflowEnabled) {
          throw new TerminalLaunchError('CROSS_AGENT_DISABLED');
        }
        if (
          !hasSessionHandoffSourceSupport(session.provider) ||
          !hasSessionHandoffDestinationSupport(destinationProvider) ||
          !settings.enabledProviders.includes(session.provider) ||
          !settings.enabledProviders.includes(destinationProvider) ||
          this.dependencies.sessionCatalogRegistry.get(session.provider) === null ||
          this.dependencies.sessionCatalogRegistry.get(destinationProvider) === null
        ) {
          throw new TerminalLaunchError('PROVIDER_UNAVAILABLE');
        }
        sessionId = null;
        nativeSessionId = null;
        sourceSession = session;
        args = [];
      }
    }
    const workspace = this.dependencies.repository.getWorkspace(
      workspaceId
    );
    if (workspace === null || !workspace.available) {
      throw new TerminalLaunchError('WORKSPACE_UNAVAILABLE');
    }

    const scan = await this.dependencies.scanProviders();
    const installation = scan.providers.find(
      (candidate) => candidate.provider === provider
    );
    if (
      installation?.state !== 'ready' ||
      !(await this.dependencies.isExecutablePath(installation.executablePath))
    ) {
      throw new TerminalLaunchError('PROVIDER_UNAVAILABLE');
    }
    const sessionAdapter = this.dependencies.sessionCatalogRegistry.get(provider);
    if (
      sessionAdapter !== null &&
      !isAdapterCompatible(sessionAdapter, installation)
    ) {
      throw new TerminalLaunchError('PROVIDER_UNAVAILABLE');
    }
    if (
      request.strategy === 'fork' &&
      !supportsNativeForkVersion(provider, installation.version)
    ) {
      throw new TerminalLaunchError('NATIVE_FORK_UNAVAILABLE');
    }
    if (sourceSession !== null) {
      const sourceInstallation = scan.providers.find(
        (candidate) => candidate.provider === sourceSession!.provider
      );
      const sourceAdapter = this.dependencies.sessionCatalogRegistry.get(
        sourceSession.provider
      );
      if (
        sourceInstallation?.state !== 'ready' ||
        sourceAdapter === null ||
        !isAdapterCompatible(sourceAdapter, sourceInstallation)
      ) {
        throw new TerminalLaunchError('PROVIDER_UNAVAILABLE');
      }
      const settings = this.dependencies.repository.getGeneralSettings();
      const sourceKeys = this.dependencies.repository
        .listCurrentSessionSourceKeys(sourceSession.id);
      if (sourceKeys.length === 0) {
        throw new TerminalLaunchError('SESSION_UNAVAILABLE');
      }
      const plan = this.dependencies.handoffService.reserve({
        sourceSessionId: sourceSession.id,
        sourceNativeId: sourceSession.nativeId,
        sourceProvider: sourceSession.provider,
        destinationProvider: provider,
        retentionDays: settings.crossAgentHandoffRetentionDays,
        startPrompt: request.startPrompt
      });
      args = buildManagedHandoffArguments(provider, plan.prompt);
      handoff = {
        plan,
        sourceKeys: [...sourceKeys].sort(),
        sourceExecutablePath: sourceInstallation.executablePath
      };
    }

    const resolved = resolveLaunchSettings({
      provider,
      workspaceId: workspace.id,
      sessionId:
        request.strategy === 'fork'
          ? fork?.sourceSessionId ?? null
          : sessionId,
      requestedTerminalProfileId: request.terminalProfileId,
      layers: this.dependencies.repository.listLaunchSettingsLayers(),
      profiles: this.dependencies.repository.listProfiles()
    });
    const profile = resolved.profile;
    if (profile === null) {
      throw new TerminalLaunchError('TERMINAL_PROFILE_UNAVAILABLE');
    }
    const environment = this.dependencies.buildEnvironment?.(
      this.dependencies.env,
      profile
    ) ?? environmentWithProfile(this.dependencies.env, profile);
    const command = resolved.command;
    let reconciliationBaselineNativeIds: string[] | null = null;
    if (
      (
        request.strategy === 'new' ||
        request.strategy === 'fork' ||
        handoff !== null
      ) &&
      this.dependencies.sessionCatalogRegistry.get(provider) !== null
    ) {
      try {
        reconciliationBaselineNativeIds = normalizeSessionBaseline(
          await this.dependencies.captureSessionBaseline(provider, workspace.id)
        );
      } catch {
        reconciliationBaselineNativeIds = null;
      }
    }
    const createdAt = this.clock();
    const partial = {
      displayName,
      strategy: handoff === null ? request.strategy : 'new' as const,
      sessionId,
      nativeSessionId,
      reconciliationBaselineNativeIds,
      provider,
      workspaceId: workspace.id,
      executablePath: installation.executablePath,
      args,
      command,
      workingDirectory: workspace.canonicalPath,
      environment,
      terminalProfile: profile,
      configuration: resolved.configuration,
      cols: request.cols,
      rows: request.rows,
      handoff,
      fork
    };
    const spec: LaunchSpec = {
      ...partial,
      launchHash: launchHash(partial, token),
      createdAt: createdAt.toISOString()
    };
    const expiresAtMs = createdAt.getTime() + 5 * 60 * 1_000;
    const preview = LaunchPreviewSchema.parse({
      launchToken: token,
      launchHash: spec.launchHash,
      strategy: spec.strategy,
      sessionId: spec.sessionId,
      provider: spec.provider,
      executablePath: spec.executablePath,
      args: spec.args,
      command: spec.command,
      workingDirectory: spec.workingDirectory,
      workspaceTrusted: this.dependencies.repository.isWorkspaceTrusted(
        workspace.id,
        workspace.canonicalPath
      ),
      environmentNames: Object.keys(spec.environment).sort(),
      terminalProfile: spec.terminalProfile,
      configuration: spec.configuration,
      warnings: resolved.warnings,
      createdAt: spec.createdAt,
      expiresAt: new Date(expiresAtMs).toISOString()
    });
    if (generation !== this.prepareGeneration) {
      return preview;
    }
    this.prepared.set(token, {
      spec,
      expiresAtMs,
      requestedTerminalProfileId: request.terminalProfileId,
      startPrompt: request.startPrompt
    });
    const expiryTimer = setTimeout(
      () => this.removePrepared(token),
      Math.max(0, expiresAtMs - this.clock().getTime())
    );
    expiryTimer.unref?.();
    this.expiryTimers.set(token, expiryTimer);

    return preview;
  }

  trustWorkspaceForLaunch(token: string): WorkspaceTrustDecision {
    const prepared = this.getPrepared(token);
    const workspace = this.dependencies.repository.getWorkspace(
      prepared.spec.workspaceId
    );
    if (
      workspace === null ||
      !workspace.available ||
      workspace.canonicalPath !== prepared.spec.workingDirectory
    ) {
      throw new TerminalLaunchError('WORKSPACE_UNAVAILABLE');
    }
    return this.dependencies.repository.trustWorkspace(
      workspace.id,
      workspace.canonicalPath,
      this.clock().toISOString()
    );
  }

  async consume(token: string): Promise<LaunchSpec> {
    const prepared = this.getPrepared(token);
    this.removePrepared(token);

    const workspace = this.dependencies.repository.getWorkspace(
      prepared.spec.workspaceId
    );
    if (
      workspace === null ||
      !workspace.available ||
      workspace.canonicalPath !== prepared.spec.workingDirectory
    ) {
      throw new TerminalLaunchError('WORKSPACE_UNAVAILABLE');
    }
    if (
      !this.dependencies.repository.isWorkspaceTrusted(
        workspace.id,
        workspace.canonicalPath
      )
    ) {
      throw new TerminalLaunchError('WORKSPACE_NOT_TRUSTED');
    }
    if (prepared.spec.strategy === 'resume') {
      const session = this.dependencies.repository.getSession(
        prepared.spec.sessionId as string
      );
      if (
        session === null ||
        session.sourceFreshness !== 'current' ||
        session.id !== prepared.spec.sessionId ||
        session.nativeId !== prepared.spec.nativeSessionId ||
        session.provider !== prepared.spec.provider ||
        session.workspaceId !== prepared.spec.workspaceId
      ) {
        throw new TerminalLaunchError('SESSION_UNAVAILABLE');
      }
    }
    if (prepared.spec.handoff !== undefined && prepared.spec.handoff !== null) {
      const handoff = prepared.spec.handoff;
      const source = this.dependencies.repository.getSession(
        handoff.plan.sourceSessionId
      );
      const settings = this.dependencies.repository.getGeneralSettings();
      const sourceKeys = this.dependencies.repository
        .listCurrentSessionSourceKeys(handoff.plan.sourceSessionId)
        .sort();
      if (
        source === null ||
        source.sourceFreshness !== 'current' ||
        source.nativeId !== handoff.plan.sourceNativeId ||
        source.provider !== handoff.plan.sourceProvider ||
        source.workspaceId !== prepared.spec.workspaceId ||
        !settings.crossAgentWorkflowEnabled ||
        settings.crossAgentHandoffRetentionDays !== handoff.plan.retentionDays ||
        !settings.enabledProviders.includes(handoff.plan.sourceProvider) ||
        !settings.enabledProviders.includes(handoff.plan.destinationProvider) ||
        !sameValue(sourceKeys, handoff.sourceKeys)
      ) {
        throw new TerminalLaunchError('LAUNCH_TOKEN_INVALID');
      }
    }
    if (prepared.spec.strategy === 'fork') {
      const fork = prepared.spec.fork;
      const source =
        fork === undefined || fork === null
          ? null
          : this.dependencies.repository.getSession(fork.sourceSessionId);
      const settings = this.dependencies.repository.getGeneralSettings();
      if (
        fork === undefined ||
        fork === null ||
        source === null ||
        source.sourceFreshness !== 'current' ||
        source.id !== fork.sourceSessionId ||
        source.nativeId !== fork.sourceNativeSessionId ||
        source.provider !== prepared.spec.provider ||
        source.workspaceId !== prepared.spec.workspaceId ||
        !settings.enabledProviders.includes(source.provider)
      ) {
        throw new TerminalLaunchError('LAUNCH_TOKEN_INVALID');
      }
    }
    const scan = await this.dependencies.scanProviders();
    const installation = scan.providers.find(
      (candidate) => candidate.provider === prepared.spec.provider
    );
    if (
      installation?.state !== 'ready' ||
      installation.executablePath !== prepared.spec.executablePath ||
      !(await this.dependencies.isExecutablePath(installation.executablePath))
    ) {
      throw new TerminalLaunchError('PROVIDER_UNAVAILABLE');
    }
    const adapter = this.dependencies.sessionCatalogRegistry.get(
      prepared.spec.provider
    );
    if (
      prepared.spec.strategy === 'fork' &&
      !supportsNativeForkVersion(prepared.spec.provider, installation.version)
    ) {
      throw new TerminalLaunchError('NATIVE_FORK_UNAVAILABLE');
    }
    if (
      (prepared.spec.strategy === 'resume' && adapter === null) ||
      (prepared.spec.strategy === 'fork' &&
        adapter?.buildForkArguments === undefined) ||
      (adapter !== null && !isAdapterCompatible(adapter, installation))
    ) {
      throw new TerminalLaunchError('PROVIDER_UNAVAILABLE');
    }
    if (
      prepared.spec.strategy === 'new' &&
      (prepared.spec.handoff === undefined || prepared.spec.handoff === null) &&
      !sameValue(
        buildNewArguments(prepared.spec.provider, prepared.startPrompt),
        prepared.spec.args
      )
    ) {
      throw new TerminalLaunchError('LAUNCH_TOKEN_INVALID');
    }
    if (
      prepared.spec.strategy === 'resume' &&
      !sameValue(
        adapter?.buildResumeArguments(
          prepared.spec.nativeSessionId as string,
          prepared.startPrompt
        ),
        prepared.spec.args
      )
    ) {
      throw new TerminalLaunchError('LAUNCH_TOKEN_INVALID');
    }
    if (
      prepared.spec.handoff !== undefined &&
      prepared.spec.handoff !== null &&
      !sameValue(
        buildManagedHandoffArguments(
          prepared.spec.provider,
          prepared.spec.handoff.plan.prompt
        ),
        prepared.spec.args
      )
    ) {
      throw new TerminalLaunchError('LAUNCH_TOKEN_INVALID');
    }
    if (
      prepared.spec.strategy === 'fork' &&
      prepared.spec.fork !== undefined &&
      prepared.spec.fork !== null &&
      !sameValue(
        adapter?.buildForkArguments?.(
          prepared.spec.fork.sourceNativeSessionId,
          prepared.spec.fork.startPrompt
        ),
        prepared.spec.args
      )
    ) {
      throw new TerminalLaunchError('LAUNCH_TOKEN_INVALID');
    }
    const resolved = resolveLaunchSettings({
      provider: prepared.spec.provider,
      workspaceId: prepared.spec.workspaceId,
      sessionId:
        prepared.spec.strategy === 'fork'
          ? prepared.spec.fork?.sourceSessionId ?? null
          : prepared.spec.sessionId,
      requestedTerminalProfileId: prepared.requestedTerminalProfileId,
      layers: this.dependencies.repository.listLaunchSettingsLayers(),
      profiles: this.dependencies.repository.listProfiles()
    });
    if (
      resolved.profile === null ||
      resolved.command !== prepared.spec.command ||
      !sameValue(resolved.profile, prepared.spec.terminalProfile) ||
      !sameValue(resolved.configuration, prepared.spec.configuration)
    ) {
      throw new TerminalLaunchError('LAUNCH_TOKEN_INVALID');
    }
    const profile = this.dependencies.repository.getProfile(
      prepared.spec.terminalProfile.id
    );
    if (profile === null || !profile.available) {
      throw new TerminalLaunchError('TERMINAL_PROFILE_UNAVAILABLE');
    }
    if (!(await this.dependencies.isExecutablePath(prepared.spec.executablePath))) {
      throw new TerminalLaunchError('PROVIDER_UNAVAILABLE');
    }
    if (prepared.spec.handoff !== undefined && prepared.spec.handoff !== null) {
      const handoff = prepared.spec.handoff;
      const sourceInstallation = scan.providers.find(
        (candidate) => candidate.provider === handoff.plan.sourceProvider
      );
      const sourceAdapter = this.dependencies.sessionCatalogRegistry.get(
        handoff.plan.sourceProvider
      );
      if (
        sourceInstallation?.state !== 'ready' ||
        sourceInstallation.executablePath !== handoff.sourceExecutablePath ||
        sourceAdapter === null ||
        !isAdapterCompatible(sourceAdapter, sourceInstallation)
      ) {
        throw new TerminalLaunchError('PROVIDER_UNAVAILABLE');
      }
      try {
        await this.dependencies.handoffService.materialize(
          handoff.plan,
          (sourceDirectory) => sourceAdapter.snapshotHandoff({
            nativeSessionId: handoff.plan.sourceNativeId,
            sourceKeys: handoff.sourceKeys,
            installation: sourceInstallation,
            sourceDirectory
          })
        );
      } catch {
        throw new TerminalLaunchError('HANDOFF_PREPARATION_FAILED');
      }
    }
    return prepared.spec;
  }

  private getPrepared(token: string): PreparedLaunch {
    const prepared = this.prepared.get(token);
    if (prepared === undefined) {
      throw new TerminalLaunchError('LAUNCH_TOKEN_INVALID');
    }
    if (this.clock().getTime() > prepared.expiresAtMs) {
      this.removePrepared(token);
      throw new TerminalLaunchError('LAUNCH_TOKEN_EXPIRED');
    }
    return prepared;
  }

  private removePrepared(token: string): void {
    this.prepared.delete(token);
    const expiryTimer = this.expiryTimers.get(token);
    if (expiryTimer !== undefined) {
      clearTimeout(expiryTimer);
      this.expiryTimers.delete(token);
    }
  }

  private clearPrepared(): void {
    for (const token of this.prepared.keys()) {
      this.removePrepared(token);
    }
  }
}
