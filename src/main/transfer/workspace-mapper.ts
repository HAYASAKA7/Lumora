import { posix, win32 } from 'node:path';

export type TransferPlatform = 'win32' | 'darwin' | 'linux';

export const WORKSPACE_MATCH_CONFIDENCE = Object.freeze({
  exactCanonicalPath: 100,
  uniqueGitRemote: 90,
  uniqueNameAndMarkers: 70,
  nameOnly: 40
} as const);

const MAX_WORKSPACES = 25_000;
const STABLE_ID = /^[a-f0-9]{64}$/;

type PathApi = typeof posix;

export interface ArchiveSessionEntry {
  readonly sessionId: string;
  readonly sourceWorkspaceKey: string;
  readonly workspacePath: string;
  readonly workspaceName: string;
  readonly gitRemote: string | null;
  readonly markers: readonly string[];
}

export interface WorkspaceTransferGroup {
  readonly sourceWorkspaceKey: string;
  readonly originalPath: string;
  readonly displayName: string;
  readonly gitRemote: string | null;
  readonly markers: readonly string[];
  readonly sessionIds: readonly string[];
}

export interface WorkspaceMappingCandidate {
  readonly workspaceId: string;
  readonly canonicalPath: string;
  readonly displayName: string;
  readonly gitRemote: string | null;
  readonly markers: readonly string[];
}

export interface WorkspacePathProbes {
  isDirectory(path: string): Promise<boolean>;
}

export interface WorkspaceMappingInput {
  readonly sourcePlatform: TransferPlatform;
  readonly destinationPlatform: TransferPlatform;
  readonly groups: readonly WorkspaceTransferGroup[];
  readonly candidates: readonly WorkspaceMappingCandidate[];
  readonly probes: WorkspacePathProbes;
}

export type WorkspaceMappingReason =
  | 'exact_canonical_path'
  | 'unique_git_remote'
  | 'unique_name_and_markers'
  | 'name_only'
  | 'ambiguous'
  | 'no_match';

export type WorkspaceMappingProposal = Readonly<
  | {
      sourceWorkspaceKey: string;
      state: 'mapped' | 'suggested';
      reason: Exclude<WorkspaceMappingReason, 'ambiguous' | 'no_match'>;
      confidence: number;
      destinationWorkspaceId: string;
      destinationPath: string;
    }
  | {
      sourceWorkspaceKey: string;
      state: 'unresolved';
      reason: 'ambiguous' | 'no_match';
      confidence: number;
      destinationWorkspaceId: null;
      destinationPath: null;
    }
>;

export interface RootMappingInput {
  readonly sourceRoot: string;
  readonly destinationRoot: string;
  readonly sourcePlatform: TransferPlatform;
  readonly destinationPlatform: TransferPlatform;
  readonly workspacePaths: readonly string[];
  readonly probes: WorkspacePathProbes;
}

export interface ExplicitWorkspaceMappingInput {
  readonly sourceWorkspaceKey: string;
  readonly destinationWorkspaceId: string;
  readonly destinationPath: string;
  readonly destinationPlatform: TransferPlatform;
  readonly probes: WorkspacePathProbes;
}

export interface ValidatedWorkspaceMapping {
  readonly sourceWorkspaceKey: string;
  readonly destinationWorkspaceId: string;
  readonly destinationPath: string;
}

interface ScoredCandidate {
  readonly candidate: WorkspaceMappingCandidate;
  readonly confidence: number;
  readonly reason: Exclude<WorkspaceMappingReason, 'ambiguous' | 'no_match'>;
}

function pathApi(platform: TransferPlatform): PathApi {
  return platform === 'win32' ? win32 : posix;
}

function assertBoundedText(value: string, name: string, max: number): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > max) {
    throw new Error(`${name} is invalid.`);
  }
  return normalized;
}

function assertStableId(value: string, name: string): string {
  if (!STABLE_ID.test(value)) {
    throw new Error(`${name} must be a stable identifier.`);
  }
  return value;
}

function normalizedPath(path: string, platform: TransferPlatform): string {
  const api = pathApi(platform);
  if (!api.isAbsolute(path)) {
    throw new Error(
      'Workspace paths must be absolute for their declared platform.'
    );
  }
  return api.normalize(path);
}

function comparablePath(path: string, platform: TransferPlatform): string {
  const normalized = normalizedPath(path, platform);
  return platform === 'win32' ? normalized.toLocaleLowerCase() : normalized;
}

function normalizedName(value: string): string {
  return value.trim().normalize('NFKC').toLocaleLowerCase();
}

function normalizedMarkers(values: readonly string[]): string[] {
  if (values.length > 256) {
    throw new Error('Workspace marker evidence exceeds the supported limit.');
  }
  return [
    ...new Set(
      values.map((value) =>
        assertBoundedText(value, 'Workspace marker', 256)
          .normalize('NFKC')
          .toLocaleLowerCase()
      )
    )
  ].sort();
}

function normalizedGitRemote(value: string | null): string | null {
  if (value === null) return null;
  const remote = value.trim();
  if (remote.length === 0 || remote.length > 2_048) return null;

  const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(remote);
  if (scp !== null && !/^[a-z][a-z0-9+.-]*:\/\//i.test(remote)) {
    return `${scp[1]!.toLocaleLowerCase()}/${scp[2]!
      .replace(/^\/+|\/+$/g, '')
      .replace(/\.git$/i, '')}`;
  }

  try {
    const parsed = new URL(remote);
    return `${parsed.hostname.toLocaleLowerCase()}/${parsed.pathname
      .replace(/^\/+|\/+$/g, '')
      .replace(/\.git$/i, '')}`;
  } catch {
    return remote.replace(/\.git$/i, '');
  }
}

async function isExistingDirectory(
  probes: WorkspacePathProbes,
  path: string
): Promise<boolean> {
  try {
    return await probes.isDirectory(path);
  } catch {
    return false;
  }
}

function freezeGroup(group: WorkspaceTransferGroup): WorkspaceTransferGroup {
  return Object.freeze({
    ...group,
    markers: Object.freeze([...group.markers]),
    sessionIds: Object.freeze([...group.sessionIds])
  });
}

export function groupArchiveWorkspaces(
  entries: readonly ArchiveSessionEntry[]
): readonly WorkspaceTransferGroup[] {
  if (entries.length > MAX_WORKSPACES) {
    throw new Error('Archive session count exceeds the workspace mapping limit.');
  }
  const groups = new Map<
    string,
    {
      originalPath: string;
      displayName: string;
      gitRemote: string | null;
      markers: Set<string>;
      sessionIds: Set<string>;
    }
  >();

  for (const entry of entries) {
    const sourceWorkspaceKey = assertBoundedText(
      entry.sourceWorkspaceKey,
      'Source workspace key',
      512
    );
    const originalPath = assertBoundedText(
      entry.workspacePath,
      'Source workspace path',
      32_768
    );
    const displayName = assertBoundedText(
      entry.workspaceName,
      'Workspace display name',
      256
    );
    const gitRemote = entry.gitRemote?.trim() || null;
    const markers = normalizedMarkers(entry.markers);
    const sessionId = assertStableId(entry.sessionId, 'Session ID');
    const current = groups.get(sourceWorkspaceKey);
    if (current === undefined) {
      groups.set(sourceWorkspaceKey, {
        originalPath,
        displayName,
        gitRemote,
        markers: new Set(markers),
        sessionIds: new Set([sessionId])
      });
      continue;
    }
    if (
      current.originalPath !== originalPath ||
      current.displayName !== displayName ||
      normalizedGitRemote(current.gitRemote) !== normalizedGitRemote(gitRemote)
    ) {
      throw new Error('Archive workspace metadata is inconsistent.');
    }
    for (const marker of markers) current.markers.add(marker);
    current.sessionIds.add(sessionId);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([sourceWorkspaceKey, value]) =>
      freezeGroup({
        sourceWorkspaceKey,
        originalPath: value.originalPath,
        displayName: value.displayName,
        gitRemote: value.gitRemote,
        markers: [...value.markers].sort(),
        sessionIds: [...value.sessionIds].sort()
      })
    );
}

function scoreCandidate(
  group: WorkspaceTransferGroup,
  candidate: WorkspaceMappingCandidate,
  sourcePlatform: TransferPlatform,
  destinationPlatform: TransferPlatform
): ScoredCandidate | null {
  if (
    sourcePlatform === destinationPlatform &&
    comparablePath(group.originalPath, sourcePlatform) ===
      comparablePath(candidate.canonicalPath, destinationPlatform)
  ) {
    return {
      candidate,
      confidence: WORKSPACE_MATCH_CONFIDENCE.exactCanonicalPath,
      reason: 'exact_canonical_path'
    };
  }

  const groupRemote = normalizedGitRemote(group.gitRemote);
  const candidateRemote = normalizedGitRemote(candidate.gitRemote);
  if (groupRemote !== null && groupRemote === candidateRemote) {
    return {
      candidate,
      confidence: WORKSPACE_MATCH_CONFIDENCE.uniqueGitRemote,
      reason: 'unique_git_remote'
    };
  }

  if (
    normalizedName(group.displayName) !== normalizedName(candidate.displayName)
  ) {
    return null;
  }
  const expectedMarkers = normalizedMarkers(group.markers);
  const candidateMarkers = new Set(normalizedMarkers(candidate.markers));
  if (
    expectedMarkers.length > 0 &&
    expectedMarkers.every((marker) => candidateMarkers.has(marker))
  ) {
    return {
      candidate,
      confidence: WORKSPACE_MATCH_CONFIDENCE.uniqueNameAndMarkers,
      reason: 'unique_name_and_markers'
    };
  }
  return {
    candidate,
    confidence: WORKSPACE_MATCH_CONFIDENCE.nameOnly,
    reason: 'name_only'
  };
}

export async function proposeWorkspaceMappings(
  input: WorkspaceMappingInput
): Promise<readonly WorkspaceMappingProposal[]> {
  if (
    input.groups.length > MAX_WORKSPACES ||
    input.candidates.length > MAX_WORKSPACES
  ) {
    throw new Error('Workspace mapping input exceeds the supported limit.');
  }

  const candidates: WorkspaceMappingCandidate[] = [];
  const candidateIds = new Set<string>();
  for (const candidate of input.candidates) {
    assertStableId(candidate.workspaceId, 'Destination workspace ID');
    const canonicalPath = normalizedPath(
      candidate.canonicalPath,
      input.destinationPlatform
    );
    if (candidateIds.has(candidate.workspaceId)) {
      throw new Error('Destination workspace IDs must be unique.');
    }
    candidateIds.add(candidate.workspaceId);
    if (!(await isExistingDirectory(input.probes, canonicalPath))) continue;
    candidates.push(
      Object.freeze({
        ...candidate,
        canonicalPath,
        displayName: assertBoundedText(
          candidate.displayName,
          'Workspace display name',
          256
        ),
        markers: Object.freeze(normalizedMarkers(candidate.markers))
      })
    );
  }

  const proposals: WorkspaceMappingProposal[] = [];
  for (const group of input.groups) {
    const sourceWorkspaceKey = assertBoundedText(
      group.sourceWorkspaceKey,
      'Source workspace key',
      512
    );
    normalizedPath(group.originalPath, input.sourcePlatform);
    const scored = candidates
      .map((candidate) =>
        scoreCandidate(
          group,
          candidate,
          input.sourcePlatform,
          input.destinationPlatform
        )
      )
      .filter((value): value is ScoredCandidate => value !== null)
      .sort(
        (left, right) =>
          right.confidence - left.confidence ||
          left.candidate.workspaceId.localeCompare(right.candidate.workspaceId)
      );
    const highest = scored[0];
    if (highest === undefined) {
      proposals.push(
        Object.freeze({
          sourceWorkspaceKey,
          state: 'unresolved',
          reason: 'no_match',
          confidence: 0,
          destinationWorkspaceId: null,
          destinationPath: null
        })
      );
      continue;
    }
    const ties = scored.filter(
      (candidate) => candidate.confidence === highest.confidence
    );
    if (ties.length !== 1) {
      proposals.push(
        Object.freeze({
          sourceWorkspaceKey,
          state: 'unresolved',
          reason: 'ambiguous',
          confidence: highest.confidence,
          destinationWorkspaceId: null,
          destinationPath: null
        })
      );
      continue;
    }
    proposals.push(
      Object.freeze({
        sourceWorkspaceKey,
        state:
          highest.confidence >=
          WORKSPACE_MATCH_CONFIDENCE.uniqueNameAndMarkers
            ? 'mapped'
            : 'suggested',
        reason: highest.reason,
        confidence: highest.confidence,
        destinationWorkspaceId: highest.candidate.workspaceId,
        destinationPath: highest.candidate.canonicalPath
      })
    );
  }

  return Object.freeze(proposals);
}

export async function applyRootMapping(
  input: RootMappingInput
): Promise<readonly string[]> {
  if (input.workspacePaths.length > MAX_WORKSPACES) {
    throw new Error('Workspace mapping input exceeds the supported limit.');
  }
  const sourceApi = pathApi(input.sourcePlatform);
  const destinationApi = pathApi(input.destinationPlatform);
  const sourceRoot = normalizedPath(input.sourceRoot, input.sourcePlatform);
  const destinationRoot = normalizedPath(
    input.destinationRoot,
    input.destinationPlatform
  );
  const destinations: string[] = [];

  for (const workspacePath of input.workspacePaths) {
    const sourcePath = normalizedPath(workspacePath, input.sourcePlatform);
    const relative = sourceApi.relative(sourceRoot, sourcePath);
    if (
      relative === '..' ||
      relative.startsWith(`..${sourceApi.sep}`) ||
      sourceApi.isAbsolute(relative)
    ) {
      throw new Error('A workspace path is outside the selected source root.');
    }
    const segments = relative === '' ? [] : relative.split(sourceApi.sep);
    const destination = destinationApi.normalize(
      destinationApi.join(destinationRoot, ...segments)
    );
    if (!(await isExistingDirectory(input.probes, destination))) {
      throw new Error(
        'Every mapped destination must already exist as a directory.'
      );
    }
    destinations.push(destination);
  }

  return Object.freeze(destinations);
}

export async function validateExplicitWorkspaceMapping(
  input: ExplicitWorkspaceMappingInput
): Promise<ValidatedWorkspaceMapping> {
  const sourceWorkspaceKey = assertBoundedText(
    input.sourceWorkspaceKey,
    'Source workspace key',
    512
  );
  const destinationWorkspaceId = assertStableId(
    input.destinationWorkspaceId,
    'Destination workspace ID'
  );
  const destinationPath = normalizedPath(
    input.destinationPath,
    input.destinationPlatform
  );
  if (!(await isExistingDirectory(input.probes, destinationPath))) {
    throw new Error('The selected destination must already exist as a directory.');
  }
  return Object.freeze({
    sourceWorkspaceKey,
    destinationWorkspaceId,
    destinationPath
  });
}
