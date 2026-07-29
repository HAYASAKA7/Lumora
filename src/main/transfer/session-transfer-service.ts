import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { mkdir, rename, rm } from 'node:fs/promises';

import { z } from 'zod';

import {
  ProviderIdSchema,
  type ProviderId,
  type ProviderInstallation,
  type ProviderScanResult,
  type SystemInfo
} from '../../shared/contracts';
import { providerDefinition } from '../../shared/provider-definitions';
import {
  SessionExportExecuteRequestSchema,
  SessionExportPlanSchema,
  SessionExportPrepareRequestSchema,
  SessionImportInspectRequestSchema,
  SessionImportInspectionSchema,
  SessionImportPlanRequestSchema,
  SessionImportPlanSchema,
  SessionTransferArchiveSelectionSchema,
  SessionTransferCapabilityListSchema,
  SessionTransferProgressEventSchema,
  SessionTransferResultSchema,
  TransferHistoryEntrySchema,
  TransferOperationCancelRequestSchema,
  type SessionExportExecuteRequest,
  type SessionExportPlan,
  type SessionExportPrepareRequest,
  type SessionImportInspectRequest,
  type SessionImportInspection,
  type SessionImportPlan,
  type SessionImportPlanRequest,
  type SessionTransferArchiveSelection,
  type SessionTransferCapability,
  type SessionTransferProgressEvent,
  type SessionTransferResult,
  type TransferHistoryEntry,
  type TransferSkipReason,
  type TransferSupport
} from '../../shared/session-transfer';
import type { CatalogTransferSession } from '../storage/catalog-repository';
import type {
  ActiveTransferSessions,
  ActiveTransferScope
} from '../terminal/terminal-runtime';
import {
  inspectArchiveEnvelope,
  openSessionArchive,
  writeSessionArchive,
  type OpenedArchive,
  type OpenedArchiveEntry,
  type SessionArchiveManifest
} from './archive-format';
import type { ProviderImportInspection } from './transfer-adapter';
import type { TransferAdapterRegistry } from './transfer-adapter-registry';
import {
  groupArchiveWorkspaces,
  proposeWorkspaceMappings,
  validateExplicitWorkspaceMapping,
  type WorkspaceMappingCandidate,
  type WorkspacePathProbes
} from './workspace-mapper';

const PLAN_TTL_MS = 15 * 60 * 1000;
const MIN_FREE_DISK_BYTES = 16 * 1024 * 1024;
const PROGRESS_INTERVAL_MS = 100;
const TRANSFER_EXTENSION = '.lumora-sessions';
type ReadyInstallation = Extract<ProviderInstallation, { state: 'ready' }>;

type OperationRunner = <T>(work: (context: {
  operationId: string;
  stagingDirectory: string;
  signal: AbortSignal;
}) => Promise<T>) => Promise<T>;

export interface TransferCatalogPort {
  getTransferSession(sessionId: string): CatalogTransferSession | null;
  getTransferSessionProvider(sessionId: string): ProviderId | null;
  hasNativeSession(provider: ProviderId, nativeSessionId: string): boolean;
}
export interface TransferWorkspaceSummary {
  readonly id: string;
  readonly canonicalPath: string;
  readonly displayName: string;
}
export interface TransferHistoryPort {
  getLastDirectory(direction: 'export' | 'import'): string | null;
  saveLastDirectory(direction: 'export' | 'import', path: string, timestamp: string): string;
  listHistory(): TransferHistoryEntry[];
  recordHistory(value: TransferHistoryEntry): TransferHistoryEntry[];
}
export interface SessionTransferServiceDependencies {
  platform: SystemInfo['platform'];
  adapters: TransferAdapterRegistry;
  catalog: TransferCatalogPort;
  activeSessions(): ActiveTransferSessions;
  scanProviders(): Promise<ProviderScanResult>;
  workspaceById(workspaceId: string): TransferWorkspaceSummary | null;
  workspaceCandidates(): Promise<readonly WorkspaceMappingCandidate[]>;
  workspaceProbes: WorkspacePathProbes;
  stagingRoot: string;
  runOperation: OperationRunner;
  cancelOperation(operationId: string): boolean;
  history: TransferHistoryPort;
  refreshCatalog(): Promise<void>;
  freeDiskBytes(path: string): Promise<number>;
  clock(): Date;
  createToken(): string;
  onProgress(event: SessionTransferProgressEvent): void;
}

export class SessionTransferError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'SessionTransferError';
  }
}

const ArchiveWorkspaceSchema = z.strictObject({
  key: z.string().trim().min(1).max(512),
  path: z.string().min(1).max(32_768),
  displayName: z.string().trim().min(1).max(256),
  gitRemote: z.string().trim().min(1).max(2_048).nullable(),
  markers: z.array(z.string().trim().min(1).max(256)).max(256)
});
const ArchiveSessionSchema = z.strictObject({
  sessionId: z.string().regex(/^[a-f0-9]{64}$/),
  provider: ProviderIdSchema,
  nativeSessionId: z.string().trim().min(1).max(256),
  title: z.string().trim().min(1).max(256),
  workspace: ArchiveWorkspaceSchema,
  entryName: z.string().trim().min(1).max(4_096),
  providerVersion: z.string().trim().min(1).max(256),
  adapterSchemaVersion: z.literal(1)
});
const TransferArchiveManifestSchema = z.strictObject({
  formatVersion: z.literal(1),
  createdAt: z.iso.datetime(),
  sourcePlatform: z.enum(['win32', 'darwin', 'linux']),
  sessions: z.array(ArchiveSessionSchema).min(1).max(25_000)
}).superRefine((manifest, context) => {
  const sessionIds = new Set<string>();
  const entries = new Set<string>();
  const nativeIds = new Set<string>();
  manifest.sessions.forEach((session, index) => {
    const nativeKey = `${session.provider}\u0000${session.nativeSessionId}`;
    for (const [set, value, field, message] of [
      [sessionIds, session.sessionId, 'sessionId', 'Archive session IDs must be unique.'],
      [entries, session.entryName, 'entryName', 'Archive entries must be unique.'],
      [nativeIds, nativeKey, 'nativeSessionId', 'Provider-native IDs must be unique.']
    ] as const) {
      if (set.has(value)) context.addIssue({ code: 'custom', path: ['sessions', index, field], message });
      set.add(value);
    }
  });
});
type TransferArchiveManifest = z.infer<typeof TransferArchiveManifestSchema>;
type ArchiveSession = TransferArchiveManifest['sessions'][number];

interface InternalExportPlan {
  kind: 'export-plan'; expiresAt: number; publicPlan: SessionExportPlan;
  sessions: readonly CatalogTransferSession[];
}
interface ArchiveSelection {
  kind: 'archive-selection'; expiresAt: number; archivePath: string;
  fileName: string; encrypted: boolean;
}
interface InspectedSession {
  manifest: ArchiveSession; entry: OpenedArchiveEntry;
  inspection: ProviderImportInspection | null; support: TransferSupport;
}
interface InternalInspection {
  kind: 'import-inspection'; expiresAt: number; archivePath: string;
  stagingDirectory: string; manifest: TransferArchiveManifest;
  sessions: readonly InspectedSession[]; publicInspection: SessionImportInspection;
}
interface ReadyImportSession {
  session: InspectedSession; destinationWorkspaceId: string;
  destinationWorkspacePath: string;
}
interface InternalImportPlan {
  kind: 'import-plan'; expiresAt: number; archivePath: string;
  stagingDirectory: string; publicPlan: SessionImportPlan;
  sourcePlatform: SystemInfo['platform']; ready: readonly ReadyImportSession[];
}
type OperationState = InternalExportPlan | ArchiveSelection | InternalInspection | InternalImportPlan;

function supportSkipReason(support: TransferSupport): TransferSkipReason {
  return support === 'provider_not_installed' || support === 'provider_disabled' ||
    support === 'route_unverified' ? support : 'route_unverified';
}
function skipMessage(provider: ProviderId, reason: TransferSkipReason): string {
  const name = providerDefinition(provider).displayName;
  const messages: Record<TransferSkipReason, string> = {
    running: 'Stop the session before exporting it.',
    duplicate: `${name} already has this session; Lumora will not overwrite it.`,
    provider_not_installed: `Install ${name} before importing this session.`,
    provider_disabled: `Enable ${name} in General Settings before importing this session.`,
    route_unverified: `${name} transfer verification is pending for this platform route.`,
    workspace_unresolved: 'Choose an existing destination workspace before importing this session.',
    source_changed: 'The provider session changed after transfer preparation.',
    source_unavailable: 'The provider-owned session source is not currently available.'
  };
  return messages[reason];
}
function capabilityMap(registry: TransferAdapterRegistry, destination: SystemInfo['platform'], source = destination) {
  return new Map(registry.capabilities(destination, source).map((value) => [value.provider, value]));
}
function currentSupport(registry: TransferAdapterRegistry, provider: ProviderId,
  destination: SystemInfo['platform'], direction: 'export' | 'import', source = destination): TransferSupport {
  return capabilityMap(registry, destination, source).get(provider)?.[direction] ?? 'route_unverified';
}
function isSessionActive(session: CatalogTransferSession, active: ActiveTransferSessions): boolean {
  return active.sessionIds.includes(session.id) || active.unresolvedScopes.some(
    (scope: ActiveTransferScope) => scope.provider === session.provider && scope.workspaceId === session.workspaceId
  );
}
function installationsByProvider(scan: ProviderScanResult): Map<ProviderId, ReadyInstallation> {
  const result = new Map<ProviderId, ReadyInstallation>();
  for (const installation of scan.providers) if (installation.state === 'ready') result.set(installation.provider, installation);
  return result;
}
function uniqueProviders(values: readonly ProviderId[]): ProviderId[] {
  return [...new Set(values)].sort();
}
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new Error('The session transfer was cancelled.');
  error.name = 'AbortError';
  throw error;
}
function publicGuidance(provider: ProviderId, support: TransferSupport): string | null {
  const definition = providerDefinition(provider);
  if (support === 'provider_not_installed') return `Install ${definition.displayName} from ${definition.installGuideUrl}`;
  if (support === 'provider_disabled') return `Enable ${definition.displayName} in General Settings.`;
  if (support === 'provider_version_unsupported') return `Update ${definition.displayName}, then check again.`;
  return null;
}
function parseManifest(value: SessionArchiveManifest): TransferArchiveManifest {
  const parsed = TransferArchiveManifestSchema.safeParse(value);
  if (!parsed.success) throw new SessionTransferError('ARCHIVE_MANIFEST_INVALID', 'The session archive manifest is invalid.');
  return parsed.data;
}
function entryMap(manifest: TransferArchiveManifest, opened: OpenedArchive): Map<string, OpenedArchiveEntry> {
  const entries = new Map(opened.entries.map((entry) => [entry.name, entry]));
  if (entries.size !== opened.entries.length || entries.size !== manifest.sessions.length ||
    manifest.sessions.some((session) => !entries.has(session.entryName))) {
    throw new SessionTransferError('ARCHIVE_ENTRY_MISMATCH', 'Archive entries do not match its manifest.');
  }
  return entries;
}

export class SessionTransferService {
  private readonly states = new Map<string, OperationState>();
  private disposed = false;
  constructor(private readonly dependencies: SessionTransferServiceDependencies) {}

  private now(): number { return this.dependencies.clock().getTime(); }
  private token(): string {
    const token = this.dependencies.createToken();
    if (!z.uuid().safeParse(token).success) {
      throw new SessionTransferError('TRANSFER_TOKEN_INVALID', 'Lumora could not create a transfer token.');
    }
    return token;
  }
  private assertOpen(): void {
    if (this.disposed) throw new SessionTransferError('TRANSFER_SERVICE_CLOSED', 'The transfer service is closed.');
  }
  private async state<K extends OperationState['kind']>(token: string, kind: K): Promise<Extract<OperationState, { kind: K }>> {
    this.assertOpen();
    const state = this.states.get(token);
    if (state === undefined || state.kind !== kind) {
      throw new SessionTransferError('TRANSFER_PLAN_INVALID', 'The session transfer plan is no longer available.');
    }
    if (state.expiresAt <= this.now()) {
      this.states.delete(token);
      if ('stagingDirectory' in state) await rm(state.stagingDirectory, { recursive: true, force: true });
      throw new SessionTransferError('TRANSFER_PLAN_EXPIRED', 'The session transfer plan expired. Prepare it again.');
    }
    return state as Extract<OperationState, { kind: K }>;
  }
  private progress(operationId: string, direction: 'export' | 'import') {
    let lastAt = Number.NEGATIVE_INFINITY;
    let lastPhase: SessionTransferProgressEvent['phase'] | null = null;
    return (phase: SessionTransferProgressEvent['phase'], completed: number, total: number,
      message: string, boundary = false): void => {
      const now = this.now();
      if (!boundary && phase === lastPhase && completed !== total && now - lastAt < PROGRESS_INTERVAL_MS) return;
      const event = SessionTransferProgressEventSchema.parse({ operationId, direction, phase, completed, total, message });
      lastAt = now;
      lastPhase = phase;
      this.dependencies.onProgress(event);
    };
  }

  getCapabilities(): SessionTransferCapability[] {
    this.assertOpen();
    const destinations: SystemInfo['platform'][] = ['win32', 'darwin', 'linux'];
    const current = capabilityMap(this.dependencies.adapters, this.dependencies.platform);
    return SessionTransferCapabilityListSchema.parse([...current.values()].map((capability) => ({
      provider: capability.provider,
      displayName: capability.displayName,
      exportSupport: capability.export,
      routes: destinations.map((destinationPlatform) => ({
        sourcePlatform: this.dependencies.platform,
        destinationPlatform,
        support: capabilityMap(this.dependencies.adapters, destinationPlatform, this.dependencies.platform)
          .get(capability.provider)?.import ?? 'route_unverified'
      })),
      installGuidance: publicGuidance(capability.provider, capability.export)
    })));
  }
  getHistory(): TransferHistoryEntry[] {
    this.assertOpen();
    return this.dependencies.history.listHistory();
  }

  async prepareExport(request: SessionExportPrepareRequest): Promise<SessionExportPlan> {
    this.assertOpen();
    const parsed = SessionExportPrepareRequestSchema.parse(request);
    const active = this.dependencies.activeSessions();
    const ready: CatalogTransferSession[] = [];
    const skipped: SessionExportPlan['skipped'] = [];
    for (const sessionId of parsed.sessionIds) {
      const session = this.dependencies.catalog.getTransferSession(sessionId);
      if (session === null) {
        const provider = this.dependencies.catalog.getTransferSessionProvider(sessionId);
        if (provider === null) {
          throw new SessionTransferError(
            'SESSION_SOURCE_CHANGED',
            'A selected provider session no longer exists.'
          );
        }
        skipped.push({
          sessionId,
          provider,
          reason: 'source_unavailable',
          message: skipMessage(provider, 'source_unavailable')
        });
        continue;
      }
      if (isSessionActive(session, active)) {
        skipped.push({ sessionId, provider: session.provider, reason: 'running',
          message: skipMessage(session.provider, 'running') });
        continue;
      }
      const support = currentSupport(this.dependencies.adapters, session.provider,
        this.dependencies.platform, 'export');
      if (support !== 'supported' || this.dependencies.adapters.get(session.provider) === null) {
        const reason = support === 'supported' ? 'route_unverified' : supportSkipReason(support);
        skipped.push({ sessionId, provider: session.provider, reason,
          message: skipMessage(session.provider, reason) });
        continue;
      }
      ready.push(session);
    }
    const planToken = this.token();
    const expiresAt = this.now() + PLAN_TTL_MS;
    const publicPlan = SessionExportPlanSchema.parse({
      planToken,
      sessions: ready.map((session) => ({ sessionId: session.id, nativeSessionId: session.nativeId,
        provider: session.provider, title: session.title, workspaceId: session.workspaceId, estimatedBytes: 0 })),
      skipped,
      estimatedBytes: 0,
      expiresAt: new Date(expiresAt).toISOString()
    });
    this.states.set(planToken, { kind: 'export-plan', expiresAt, publicPlan,
      sessions: Object.freeze([...ready]) });
    return publicPlan;
  }

  async executeExport(request: SessionExportExecuteRequest, outputPath: string): Promise<SessionTransferResult> {
    const parsed = SessionExportExecuteRequestSchema.parse(request);
    const plan = await this.state(parsed.planToken, 'export-plan');
    if (plan.sessions.length === 0) {
      throw new SessionTransferError('TRANSFER_NOTHING_TO_EXPORT', 'No selected sessions are eligible for export.');
    }
    if (!isAbsolute(outputPath) || !outputPath.endsWith(TRANSFER_EXTENSION)) {
      throw new SessionTransferError('TRANSFER_OUTPUT_INVALID', 'Choose an absolute Lumora session archive path.');
    }
    if (await this.dependencies.freeDiskBytes(dirname(outputPath)) < MIN_FREE_DISK_BYTES) {
      throw new SessionTransferError('INSUFFICIENT_DISK_SPACE', 'The selected destination has insufficient disk space.');
    }
    const active = this.dependencies.activeSessions();
    for (const prepared of plan.sessions) {
      const current = this.dependencies.catalog.getTransferSession(prepared.id);
      if (current === null) {
        throw new SessionTransferError('SESSION_SOURCE_CHANGED', 'A selected provider session is no longer available.');
      }
      if (isSessionActive(current, active)) {
        throw new SessionTransferError('SESSION_BECAME_ACTIVE', 'Stop all selected sessions before exporting them.');
      }
      if (current.nativeId !== prepared.nativeId || current.workspacePath !== prepared.workspacePath ||
        current.title !== prepared.title) {
        throw new SessionTransferError('SESSION_SOURCE_CHANGED', 'A selected session changed after preparation.');
      }
      if (currentSupport(this.dependencies.adapters, current.provider,
        this.dependencies.platform, 'export') !== 'supported') {
        throw new SessionTransferError('TRANSFER_CAPABILITY_CHANGED', 'Provider transfer support changed after preparation.');
      }
    }
    const installations = installationsByProvider(await this.dependencies.scanProviders());
    const result = await this.dependencies.runOperation(async (context) => {
      const progress = this.progress(context.operationId, 'export');
      progress('preparing', 0, plan.sessions.length, 'Preparing provider sessions for export.', true);
      const manifestSessions: ArchiveSession[] = [];
      const entries: { name: string; sourcePath: string; declaredSize: number }[] = [];
      let totalPayloadBytes = 0;
      let completed = 0;
      for (const session of plan.sessions) {
        throwIfAborted(context.signal);
        const adapter = this.dependencies.adapters.get(session.provider);
        const installation = installations.get(session.provider);
        if (adapter === null || installation === undefined) {
          throw new SessionTransferError('TRANSFER_PROVIDER_UNAVAILABLE', 'A selected provider is no longer ready.');
        }
        const providerStaging = join(context.stagingDirectory, session.id);
        await mkdir(providerStaging);
        const payload = await adapter.exportSession({ installation, nativeSessionId: session.nativeId,
          expectedWorkspacePath: session.workspacePath, expectedTitle: session.title,
          stagingDirectory: providerStaging, signal: context.signal });
        if (payload.provider !== session.provider || payload.nativeSessionId !== session.nativeId ||
          payload.workspacePath !== session.workspacePath || payload.title !== session.title) {
          throw new SessionTransferError('SESSION_SOURCE_CHANGED', 'A provider session changed during export.');
        }
        const entryName = `providers/${session.provider}/${session.id}.json`;
        entries.push({ name: entryName, sourcePath: payload.payloadPath, declaredSize: payload.size });
        totalPayloadBytes += payload.size;
        manifestSessions.push({ sessionId: session.id, provider: session.provider,
          nativeSessionId: session.nativeId, title: session.title,
          workspace: { key: session.workspaceId, path: session.workspacePath,
            displayName: basename(session.workspacePath), gitRemote: null, markers: [] },
          entryName, providerVersion: installation.version, adapterSchemaVersion: 1 });
        completed += 1;
        progress('reading', completed, plan.sessions.length, `Prepared ${completed} of ${plan.sessions.length} sessions.`);
      }
      const requiredDisk = Math.max(MIN_FREE_DISK_BYTES, totalPayloadBytes * 3);
      if (await this.dependencies.freeDiskBytes(dirname(outputPath)) < requiredDisk) {
        throw new SessionTransferError('INSUFFICIENT_DISK_SPACE', 'The selected destination has insufficient disk space.');
      }
      progress('writing', 0, entries.length, 'Writing the session archive.', true);
      await writeSessionArchive({ outputPath, protection: parsed.protection,
        manifest: { formatVersion: 1, createdAt: this.dependencies.clock().toISOString(),
          sourcePlatform: this.dependencies.platform, sessions: manifestSessions },
        entries, signal: context.signal });
      progress('completed', entries.length, entries.length, 'Session export completed.', true);
      const providers = uniqueProviders([
        ...plan.sessions.map((session) => session.provider),
        ...plan.publicPlan.skipped.map((session) => session.provider)
      ]);
      return SessionTransferResultSchema.parse({ operationId: context.operationId, direction: 'export',
        completedAt: this.dependencies.clock().toISOString(), status: 'completed', importedCount: 0,
        exportedCount: plan.sessions.length, skippedCount: plan.publicPlan.skipped.length, failedCount: 0,
        providers,
        items: [...plan.sessions.map((session) => ({ sessionId: session.id, provider: session.provider,
          status: 'exported' as const, reason: null, message: 'Session exported.' })),
          ...plan.publicPlan.skipped.map((session) => ({ sessionId: session.sessionId, provider: session.provider,
            status: 'skipped' as const, reason: session.reason, message: session.message }))] });
    });
    this.states.delete(parsed.planToken);
    this.dependencies.history.saveLastDirectory('export', dirname(outputPath), result.completedAt);
    this.recordHistory(result);
    return result;
  }
  async chooseImportArchive(archivePath: string): Promise<SessionTransferArchiveSelection> {
    this.assertOpen();
    if (!isAbsolute(archivePath) || !archivePath.endsWith(TRANSFER_EXTENSION)) {
      throw new SessionTransferError('TRANSFER_ARCHIVE_INVALID', 'Choose a Lumora session archive.');
    }
    const envelope = await inspectArchiveEnvelope(archivePath);
    const selectionToken = this.token();
    const selection = SessionTransferArchiveSelectionSchema.parse({
      selectionToken,
      fileName: basename(archivePath),
      encrypted: envelope.encrypted
    });
    this.states.set(selectionToken, {
      kind: 'archive-selection',
      expiresAt: this.now() + PLAN_TTL_MS,
      archivePath,
      fileName: selection.fileName,
      encrypted: envelope.encrypted
    });
    return selection;
  }

  async inspectImport(request: SessionImportInspectRequest): Promise<SessionImportInspection> {
    const parsed = SessionImportInspectRequestSchema.parse(request);
    const selection = await this.state(parsed.selectionToken, 'archive-selection');
    const inspectionToken = this.token();
    const retainedDirectory = join(this.dependencies.stagingRoot, `transfer-${inspectionToken}`);
    await mkdir(this.dependencies.stagingRoot, { recursive: true });
    let retained = false;
    try {
      const prepared = await this.dependencies.runOperation(async (context) => {
        const progress = this.progress(context.operationId, 'import');
        progress('authenticating', 0, 1, 'Authenticating the session archive.', true);
        const openedRoot = join(context.stagingDirectory, 'opened');
        const opened = await openSessionArchive({
          archivePath: selection.archivePath,
          ...(parsed.password === undefined ? {} : { password: parsed.password }),
          stagingDirectory: openedRoot,
          signal: context.signal
        });
        const manifest = parseManifest(opened.manifest);
        const entries = entryMap(manifest, opened);
        await rename(openedRoot, retainedDirectory);
        retained = true;
        const moved = new Map<string, OpenedArchiveEntry>();
        for (const [name, entry] of entries) {
          moved.set(name, {
            ...entry,
            stagedPath: join(retainedDirectory, relative(openedRoot, entry.stagedPath))
          });
        }
        progress('reading', 1, 1, 'Session archive authenticated.', true);
        return { manifest, entries: moved };
      });

      const capabilities = capabilityMap(
        this.dependencies.adapters,
        this.dependencies.platform,
        prepared.manifest.sourcePlatform
      );
      const inspectedSessions: InspectedSession[] = [];
      for (const manifestSession of prepared.manifest.sessions) {
        const entry = prepared.entries.get(manifestSession.entryName)!;
        const support = capabilities.get(manifestSession.provider)?.import ?? 'route_unverified';
        const adapter = this.dependencies.adapters.get(manifestSession.provider);
        let inspection: ProviderImportInspection | null = null;
        if (support === 'supported' && adapter !== null) {
          inspection = await adapter.inspectImport({ payloadPath: entry.stagedPath });
          if (inspection.provider !== manifestSession.provider ||
            inspection.nativeSessionId !== manifestSession.nativeSessionId ||
            inspection.workspacePath !== manifestSession.workspace.path ||
            inspection.title !== manifestSession.title) {
            throw new SessionTransferError(
              'ARCHIVE_PROVIDER_PAYLOAD_INVALID',
              'A provider payload does not match the archive manifest.'
            );
          }
        }
        inspectedSessions.push({ manifest: manifestSession, entry, inspection, support });
      }

      const groups = groupArchiveWorkspaces(prepared.manifest.sessions.map((session) => ({
        sessionId: session.sessionId,
        sourceWorkspaceKey: session.workspace.key,
        workspacePath: session.workspace.path,
        workspaceName: session.workspace.displayName,
        gitRemote: session.workspace.gitRemote,
        markers: session.workspace.markers
      })));
      const proposals = await proposeWorkspaceMappings({
        sourcePlatform: prepared.manifest.sourcePlatform,
        destinationPlatform: this.dependencies.platform,
        groups,
        candidates: await this.dependencies.workspaceCandidates(),
        probes: this.dependencies.workspaceProbes
      });
      const proposalByKey = new Map(proposals.map((proposal) => [proposal.sourceWorkspaceKey, proposal]));
      const providers = uniqueProviders(prepared.manifest.sessions.map((session) => session.provider))
        .map((provider) => {
          const support = capabilities.get(provider)?.import ?? 'route_unverified';
          return {
            provider,
            displayName: providerDefinition(provider).displayName,
            sessionCount: prepared.manifest.sessions.filter((session) => session.provider === provider).length,
            support,
            installGuidance: publicGuidance(provider, support)
          };
        });
      const expiresAt = this.now() + PLAN_TTL_MS;
      const publicInspection = SessionImportInspectionSchema.parse({
        inspectionToken,
        archiveName: selection.fileName,
        encrypted: selection.encrypted,
        sourcePlatform: prepared.manifest.sourcePlatform,
        providers,
        workspaces: groups.map((group) => {
          const proposal = proposalByKey.get(group.sourceWorkspaceKey);
          return {
            sourceWorkspaceKey: group.sourceWorkspaceKey,
            displayName: group.displayName,
            originalPath: group.originalPath,
            sessionCount: group.sessionIds.length,
            suggestedWorkspaceId: proposal?.state === 'mapped' || proposal?.state === 'suggested'
              ? proposal.destinationWorkspaceId : null,
            confidence: proposal?.state === 'mapped' ? 'high'
              : proposal?.reason === 'ambiguous' || proposal?.state === 'suggested' ? 'ambiguous' : 'none'
          };
        }),
        sessionCount: prepared.manifest.sessions.length,
        expiresAt: new Date(expiresAt).toISOString()
      });
      this.states.delete(parsed.selectionToken);
      this.states.set(inspectionToken, {
        kind: 'import-inspection',
        expiresAt,
        archivePath: selection.archivePath,
        stagingDirectory: retainedDirectory,
        manifest: prepared.manifest,
        sessions: Object.freeze(inspectedSessions),
        publicInspection
      });
      return publicInspection;
    } catch (error) {
      if (retained) await rm(retainedDirectory, { recursive: true, force: true });
      throw error;
    }
  }

  async planImport(request: SessionImportPlanRequest): Promise<SessionImportPlan> {
    const parsed = SessionImportPlanRequestSchema.parse(request);
    const inspection = await this.state(parsed.inspectionToken, 'import-inspection');
    const selectedProviders = new Set(parsed.providers);
    const archiveProviders = new Set(
      inspection.sessions.map((session) => session.manifest.provider)
    );
    if (parsed.providers.some((provider) => !archiveProviders.has(provider))) {
      throw new SessionTransferError(
        'TRANSFER_PROVIDER_NOT_IN_ARCHIVE',
        'Select only providers contained in this session archive.'
      );
    }
    const mappings = new Map(parsed.workspaceMappings.map((mapping) => [mapping.sourceWorkspaceKey, mapping]));
    const ready: ReadyImportSession[] = [];
    const skipped: SessionImportPlan['skipped'] = [];
    for (const session of inspection.sessions) {
      if (!selectedProviders.has(session.manifest.provider)) continue;
      if (session.support !== 'supported') {
        const reason = supportSkipReason(session.support);
        skipped.push({ sessionId: session.manifest.sessionId, provider: session.manifest.provider,
          reason, message: skipMessage(session.manifest.provider, reason) });
        continue;
      }
      if (session.inspection === null) {
        skipped.push({ sessionId: session.manifest.sessionId, provider: session.manifest.provider,
          reason: 'source_unavailable', message: skipMessage(session.manifest.provider, 'source_unavailable') });
        continue;
      }
      const mapping = mappings.get(session.manifest.workspace.key);
      if (mapping === undefined || mapping.action === 'skip') {
        skipped.push({ sessionId: session.manifest.sessionId, provider: session.manifest.provider,
          reason: 'workspace_unresolved', message: skipMessage(session.manifest.provider, 'workspace_unresolved') });
        continue;
      }
      const workspace = this.dependencies.workspaceById(mapping.destinationWorkspaceId);
      if (workspace === null) {
        skipped.push({ sessionId: session.manifest.sessionId, provider: session.manifest.provider,
          reason: 'workspace_unresolved', message: skipMessage(session.manifest.provider, 'workspace_unresolved') });
        continue;
      }
      await validateExplicitWorkspaceMapping({
        sourceWorkspaceKey: session.manifest.workspace.key,
        destinationWorkspaceId: workspace.id,
        destinationPath: workspace.canonicalPath,
        destinationPlatform: this.dependencies.platform,
        probes: this.dependencies.workspaceProbes
      });
      if (this.dependencies.catalog.hasNativeSession(session.manifest.provider, session.manifest.nativeSessionId)) {
        skipped.push({ sessionId: session.manifest.sessionId, provider: session.manifest.provider,
          reason: 'duplicate', message: skipMessage(session.manifest.provider, 'duplicate') });
        continue;
      }
      ready.push({
        session,
        destinationWorkspaceId: workspace.id,
        destinationWorkspacePath: workspace.canonicalPath
      });
    }
    const planToken = this.token();
    const expiresAt = this.now() + PLAN_TTL_MS;
    const publicPlan = SessionImportPlanSchema.parse({
      planToken,
      ready: ready.map(({ session, destinationWorkspaceId }) => ({
        sessionId: session.manifest.sessionId,
        nativeSessionId: session.manifest.nativeSessionId,
        provider: session.manifest.provider,
        title: session.manifest.title,
        workspaceId: destinationWorkspaceId,
        estimatedBytes: session.entry.size
      })),
      skipped,
      providers: parsed.providers,
      expiresAt: new Date(expiresAt).toISOString()
    });
    this.states.delete(parsed.inspectionToken);
    this.states.set(planToken, {
      kind: 'import-plan',
      expiresAt,
      archivePath: inspection.archivePath,
      stagingDirectory: inspection.stagingDirectory,
      publicPlan,
      sourcePlatform: inspection.manifest.sourcePlatform,
      ready: Object.freeze(ready)
    });
    return publicPlan;
  }
  async executeImport(request: { planToken: string }): Promise<SessionTransferResult> {
    const planToken = z.uuid().parse(request.planToken);
    const plan = await this.state(planToken, 'import-plan');
    const totalBytes = plan.ready.reduce((total, item) => total + item.session.entry.size, 0);
    if (await this.dependencies.freeDiskBytes(plan.stagingDirectory) <
      Math.max(MIN_FREE_DISK_BYTES, totalBytes * 2)) {
      throw new SessionTransferError('INSUFFICIENT_DISK_SPACE', 'There is not enough disk space to import these sessions.');
    }
    const result = await this.dependencies.runOperation(async (context) => {
      const progress = this.progress(context.operationId, 'import');
      const installations = installationsByProvider(await this.dependencies.scanProviders());
      const items: SessionTransferResult['items'] = plan.publicPlan.skipped.map((session) => ({
        sessionId: session.sessionId,
        provider: session.provider,
        status: 'skipped' as const,
        reason: session.reason,
        message: session.message
      }));
      const blockedProviders = new Set<ProviderId>();
      let importedCount = 0;
      let skippedCount = plan.publicPlan.skipped.length;
      let failedCount = 0;
      let completed = 0;
      let cancelled = false;
      progress('preparing', 0, plan.ready.length, 'Preparing provider imports.', true);
      for (const prepared of plan.ready) {
        if (context.signal.aborted) { cancelled = true; break; }
        const provider = prepared.session.manifest.provider;
        if (blockedProviders.has(provider)) {
          skippedCount += 1;
          completed += 1;
          items.push({ sessionId: prepared.session.manifest.sessionId, provider,
            status: 'skipped', reason: 'source_unavailable',
            message: 'A previous provider import failed; remaining sessions were not changed.' });
          continue;
        }
        const adapter = this.dependencies.adapters.get(provider);
        const installation = installations.get(provider);
        const support = currentSupport(this.dependencies.adapters, provider,
          this.dependencies.platform, 'import', plan.sourcePlatform);
        if (adapter === null || installation === undefined || support !== 'supported') {
          const reason: TransferSkipReason = installation === undefined
            ? 'provider_not_installed' : supportSkipReason(support);
          skippedCount += 1;
          completed += 1;
          items.push({ sessionId: prepared.session.manifest.sessionId, provider,
            status: 'skipped', reason, message: skipMessage(provider, reason) });
          continue;
        }
        if (this.dependencies.catalog.hasNativeSession(provider, prepared.session.manifest.nativeSessionId)) {
          skippedCount += 1;
          completed += 1;
          items.push({ sessionId: prepared.session.manifest.sessionId, provider,
            status: 'skipped', reason: 'duplicate', message: skipMessage(provider, 'duplicate') });
          continue;
        }
        let importedNativeId: string | null = null;
        try {
          const sessionStaging = join(context.stagingDirectory, prepared.session.manifest.sessionId);
          await mkdir(sessionStaging);
          const outcome = await adapter.importSession({
            installation,
            inspection: prepared.session.inspection!,
            destinationWorkspacePath: prepared.destinationWorkspacePath,
            stagingDirectory: sessionStaging,
            signal: context.signal
          });
          if (outcome.status === 'duplicate') {
            skippedCount += 1;
            items.push({ sessionId: prepared.session.manifest.sessionId, provider,
              status: 'skipped', reason: 'duplicate', message: skipMessage(provider, 'duplicate') });
          } else {
            importedNativeId = outcome.nativeSessionId;
            throwIfAborted(context.signal);
            const verified = await adapter.verifyImportedSession({
              installation,
              nativeSessionId: outcome.nativeSessionId,
              workspacePath: prepared.destinationWorkspacePath,
              title: prepared.session.manifest.title
            });
            if (!verified) {
              throw new SessionTransferError('IMPORT_VERIFICATION_FAILED', 'The provider did not verify the imported session.');
            }
            await this.dependencies.refreshCatalog();
            importedCount += 1;
            items.push({ sessionId: prepared.session.manifest.sessionId, provider,
              status: 'imported', reason: null, message: 'Session imported and verified.' });
          }
        } catch (error) {
          if (importedNativeId !== null) {
            await adapter.rollbackImport({ installation, nativeSessionId: importedNativeId }).catch(() => undefined);
          }
          if (isAbortError(error)) { cancelled = true; break; }
          failedCount += 1;
          items.push({ sessionId: prepared.session.manifest.sessionId, provider,
            status: 'failed', reason: null,
            message: 'The provider could not import and verify this session.' });
          if (typeof error === 'object' && error !== null && 'fatal' in error &&
            (error as { fatal?: unknown }).fatal === true) blockedProviders.add(provider);
        }
        completed += 1;
        progress('verifying', completed, plan.ready.length,
          `Processed ${completed} of ${plan.ready.length} sessions.`);
      }
      progress(cancelled ? 'cancelled' : 'completed', completed, plan.ready.length,
        cancelled ? 'Session import cancelled.' : 'Session import completed.', true);
      const status: SessionTransferResult['status'] = cancelled ? 'cancelled'
        : failedCount > 0 && importedCount === 0 ? 'failed'
          : failedCount > 0 || skippedCount > 0 ? 'partial' : 'completed';
      return SessionTransferResultSchema.parse({
        operationId: context.operationId,
        direction: 'import',
        completedAt: this.dependencies.clock().toISOString(),
        status,
        importedCount,
        exportedCount: 0,
        skippedCount,
        failedCount,
        providers: plan.publicPlan.providers,
        items
      });
    });
    this.states.delete(planToken);
    await rm(plan.stagingDirectory, { recursive: true, force: true });
    this.dependencies.history.saveLastDirectory('import', dirname(plan.archivePath), result.completedAt);
    this.recordHistory(result);
    return result;
  }

  cancelOperation(operationId: string): { accepted: true } {
    TransferOperationCancelRequestSchema.parse({ operationId });
    this.dependencies.cancelOperation(operationId);
    return { accepted: true };
  }

  private recordHistory(result: SessionTransferResult): void {
    this.dependencies.history.recordHistory(TransferHistoryEntrySchema.parse({
      id: result.operationId,
      direction: result.direction,
      completedAt: result.completedAt,
      importedCount: result.importedCount,
      exportedCount: result.exportedCount,
      skippedCount: result.skippedCount,
      providers: result.providers
    }));
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const staging = [...this.states.values()]
      .filter((state): state is InternalInspection | InternalImportPlan => 'stagingDirectory' in state)
      .map((state) => state.stagingDirectory);
    this.states.clear();
    await Promise.all(staging.map((path) => rm(path, { recursive: true, force: true })));
  }
}
