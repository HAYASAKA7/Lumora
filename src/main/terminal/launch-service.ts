import { createHash, randomUUID } from 'node:crypto';

import {
  LaunchPrepareRequestSchema,
  LaunchPreviewSchema,
  type LaunchPrepareRequest,
  type LaunchPreview,
  type ProviderScanResult,
  type SystemInfo,
  type TerminalProfile
} from '../../shared/contracts';
import type { WorkspaceLaunchInfo } from '../storage/terminal-repository';

type Environment = Readonly<Record<string, string | undefined>>;

interface LaunchRepository {
  getWorkspace(workspaceId: string): WorkspaceLaunchInfo | null;
  getProfile(profileId: string): TerminalProfile | null;
  getProviderLaunchCommand(provider: LaunchPrepareRequest['provider']): string | null;
}

interface LaunchServiceDependencies {
  repository: LaunchRepository;
  scanProviders(): Promise<ProviderScanResult>;
  isExecutablePath(path: string): Promise<boolean>;
  platform: SystemInfo['platform'];
  env: Environment;
  clock?: () => Date;
  createToken?: () => string;
}

export interface LaunchSpec {
  strategy: 'new';
  provider: LaunchPrepareRequest['provider'];
  workspaceId: string;
  executablePath: string;
  args: string[];
  command: string | null;
  workingDirectory: string;
  environment: Record<string, string | undefined>;
  terminalProfile: TerminalProfile;
  launchHash: string;
  cols: number;
  rows: number;
  createdAt: string;
}

interface PreparedLaunch {
  spec: LaunchSpec;
  expiresAtMs: number;
}

export type TerminalLaunchErrorCode =
  | 'WORKSPACE_UNAVAILABLE'
  | 'TERMINAL_PROFILE_UNAVAILABLE'
  | 'PROVIDER_UNAVAILABLE'
  | 'LAUNCH_TOKEN_INVALID'
  | 'LAUNCH_TOKEN_EXPIRED';

const ERROR_MESSAGES: Record<TerminalLaunchErrorCode, string> = {
  WORKSPACE_UNAVAILABLE: 'The selected workspace is unavailable.',
  TERMINAL_PROFILE_UNAVAILABLE: 'The selected terminal profile is unavailable.',
  PROVIDER_UNAVAILABLE: 'The selected provider is unavailable.',
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

function launchHash(value: Omit<LaunchSpec, 'launchHash' | 'createdAt'>): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        strategy: value.strategy,
        provider: value.provider,
        workspaceId: value.workspaceId,
        executablePath: value.executablePath,
        args: value.args,
        command: value.command,
        workingDirectory: value.workingDirectory,
        terminalProfileId: value.terminalProfile.id,
        terminalProfilePath: value.terminalProfile.executablePath,
        environmentNames: Object.keys(value.environment).sort(),
        cols: value.cols,
        rows: value.rows
      })
    )
    .digest('hex');
}

export class LaunchService {
  private readonly prepared = new Map<string, PreparedLaunch>();
  private readonly clock: () => Date;
  private readonly createToken: () => string;

  constructor(private readonly dependencies: LaunchServiceDependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
    this.createToken = dependencies.createToken ?? randomUUID;
  }

  async prepare(value: LaunchPrepareRequest): Promise<LaunchPreview> {
    const request = LaunchPrepareRequestSchema.parse(value);
    const workspace = this.dependencies.repository.getWorkspace(
      request.workspaceId
    );
    if (workspace === null || !workspace.available) {
      throw new TerminalLaunchError('WORKSPACE_UNAVAILABLE');
    }

    const profile = this.dependencies.repository.getProfile(
      request.terminalProfileId
    );
    if (profile === null || !profile.available) {
      throw new TerminalLaunchError('TERMINAL_PROFILE_UNAVAILABLE');
    }

    const scan = await this.dependencies.scanProviders();
    const installation = scan.providers.find(
      (candidate) => candidate.provider === request.provider
    );
    if (
      installation?.state !== 'ready' ||
      !(await this.dependencies.isExecutablePath(installation.executablePath))
    ) {
      throw new TerminalLaunchError('PROVIDER_UNAVAILABLE');
    }

    const environment = environmentWithProfile(this.dependencies.env, profile);
    const command = this.dependencies.repository.getProviderLaunchCommand(
      request.provider
    );
    const createdAt = this.clock();
    const partial = {
      strategy: 'new' as const,
      provider: request.provider,
      workspaceId: workspace.id,
      executablePath: installation.executablePath,
      args: [],
      command,
      workingDirectory: workspace.canonicalPath,
      environment,
      terminalProfile: profile,
      cols: request.cols,
      rows: request.rows
    };
    const spec: LaunchSpec = {
      ...partial,
      launchHash: launchHash(partial),
      createdAt: createdAt.toISOString()
    };
    const token = this.createToken();
    const expiresAtMs = createdAt.getTime() + 5 * 60 * 1_000;
    this.prepared.set(token, { spec, expiresAtMs });

    return LaunchPreviewSchema.parse({
      launchToken: token,
      launchHash: spec.launchHash,
      strategy: spec.strategy,
      provider: spec.provider,
      executablePath: spec.executablePath,
      args: spec.args,
      command: spec.command,
      workingDirectory: spec.workingDirectory,
      environmentNames: Object.keys(spec.environment).sort(),
      terminalProfile: spec.terminalProfile,
      warnings: [],
      createdAt: spec.createdAt,
      expiresAt: new Date(expiresAtMs).toISOString()
    });
  }

  async consume(token: string): Promise<LaunchSpec> {
    const prepared = this.prepared.get(token);
    this.prepared.delete(token);
    if (prepared === undefined) {
      throw new TerminalLaunchError('LAUNCH_TOKEN_INVALID');
    }
    if (this.clock().getTime() > prepared.expiresAtMs) {
      throw new TerminalLaunchError('LAUNCH_TOKEN_EXPIRED');
    }

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
    const profile = this.dependencies.repository.getProfile(
      prepared.spec.terminalProfile.id
    );
    if (profile === null || !profile.available) {
      throw new TerminalLaunchError('TERMINAL_PROFILE_UNAVAILABLE');
    }
    if (!(await this.dependencies.isExecutablePath(prepared.spec.executablePath))) {
      throw new TerminalLaunchError('PROVIDER_UNAVAILABLE');
    }
    return prepared.spec;
  }
}
