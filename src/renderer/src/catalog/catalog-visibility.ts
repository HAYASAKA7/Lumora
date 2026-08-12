import type {
  CatalogQuery,
  CatalogSnapshot,
  GeneralSettings,
  ProviderId,
  ProviderScanResult,
  SessionSummary,
  TerminalProfile,
  WorkspaceSummary,
  WorkspaceVisibilityPolicy
} from '../../../shared/contracts';
import { SESSION_PROVIDER_IDS } from '../../../shared/provider-definitions';
import { resolveSessionResumeDisabledReason } from './session-resume';

export interface HiddenWorkspaceEntry {
  workspace: WorkspaceSummary;
  policy: WorkspaceVisibilityPolicy;
}

export interface CatalogVisibilityPresentation {
  snapshot: CatalogSnapshot;
  workspaceById: ReadonlyMap<string, WorkspaceSummary>;
  hiddenWorkspaces: readonly HiddenWorkspaceEntry[];
}

interface CatalogVisibilityInput {
  snapshot: CatalogSnapshot;
  policies: readonly WorkspaceVisibilityPolicy[] | null;
  settings: Pick<
    GeneralSettings,
    'showUnavailableWorkspaces' | 'showUnusableSessions'
  >;
  providerScan: ProviderScanResult | null;
  profiles: readonly TerminalProfile[];
  query: CatalogQuery;
}

function normalizeSearch(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase();
}

function sessionMatchesQuery(
  session: SessionSummary,
  workspace: WorkspaceSummary | undefined,
  query: CatalogQuery
): boolean {
  if (query.provider !== null && session.provider !== query.provider) {
    return false;
  }
  const text = normalizeSearch(query.text);
  if (text.length === 0) return true;
  return [session.title, workspace?.displayName, workspace?.canonicalPath]
    .some((value) => value !== undefined && normalizeSearch(value).includes(text));
}

function recalculateWorkspaces(
  workspaces: readonly WorkspaceSummary[],
  sessions: readonly SessionSummary[]
): WorkspaceSummary[] {
  const counts = new Map<
    string,
    { total: number; providers: Partial<Record<ProviderId, number>>; latest: string | null }
  >();
  for (const session of sessions) {
    if (session.sourceFreshness !== 'current') continue;
    const current = counts.get(session.workspaceId) ?? {
      total: 0,
      providers: {},
      latest: null
    };
    current.total += 1;
    current.providers[session.provider] =
      (current.providers[session.provider] ?? 0) + 1;
    if (current.latest === null || session.updatedAt > current.latest) {
      current.latest = session.updatedAt;
    }
    counts.set(session.workspaceId, current);
  }
  return workspaces.map((workspace) => {
    const current = counts.get(workspace.id);
    return {
      ...workspace,
      sessionCount: current?.total ?? 0,
      providerCounts: current?.providers ?? {},
      lastActivityAt: current?.latest ?? null
    };
  });
}

function recalculateFacets(
  sessions: readonly SessionSummary[]
): CatalogSnapshot['providerFacets'] {
  const counts = new Map<ProviderId, number>();
  for (const session of sessions) {
    if (session.sourceFreshness !== 'current') continue;
    counts.set(session.provider, (counts.get(session.provider) ?? 0) + 1);
  }
  return SESSION_PROVIDER_IDS.flatMap((provider) => {
    const sessionCount = counts.get(provider);
    return sessionCount === undefined ? [] : [{ provider, sessionCount }];
  });
}

export function projectCatalogVisibility({
  snapshot,
  policies,
  settings,
  providerScan,
  profiles,
  query
}: CatalogVisibilityInput): CatalogVisibilityPresentation {
  const workspaceById = new Map(
    snapshot.workspaces.map((workspace) => [workspace.id, workspace])
  );
  const policyByWorkspace = new Map(
    (policies ?? []).map((policy) => [policy.workspaceId, policy])
  );
  const hiddenWorkspaceAndSessions = new Set(
    (policies ?? [])
      .filter(({ mode }) => mode === 'workspace_and_sessions')
      .map(({ workspaceId }) => workspaceId)
  );
  const hiddenWorkspaces = snapshot.workspaces.flatMap((workspace) => {
    const policy = policyByWorkspace.get(workspace.id);
    return policy === undefined ? [] : [{ workspace, policy }];
  });

  const baseSessions = snapshot.sessions.filter((session) => {
    if (hiddenWorkspaceAndSessions.has(session.workspaceId)) return false;
    if (settings.showUnusableSessions || providerScan === null) return true;
    return resolveSessionResumeDisabledReason({
      session,
      workspace: workspaceById.get(session.workspaceId),
      providerScan,
      profiles
    }) === null;
  });
  const visibleWorkspaces = recalculateWorkspaces(
    snapshot.workspaces.filter((workspace) =>
      !policyByWorkspace.has(workspace.id) &&
      (settings.showUnavailableWorkspaces || workspace.available)
    ),
    baseSessions
  );
  const visibleSessions = baseSessions.filter((session) =>
    sessionMatchesQuery(session, workspaceById.get(session.workspaceId), query)
  );

  return {
    workspaceById,
    hiddenWorkspaces,
    snapshot: {
      ...snapshot,
      workspaces: visibleWorkspaces,
      sessions: visibleSessions,
      providerFacets: recalculateFacets(baseSessions)
    }
  };
}
