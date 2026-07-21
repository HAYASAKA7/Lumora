export interface RuntimeSessionCandidate {
  sessionId: string;
  nativeSessionId: string;
}

export interface RuntimeSessionCandidateSet {
  runtimeId: string;
  candidates: readonly RuntimeSessionCandidate[];
}

export interface RuntimeSessionMatch extends RuntimeSessionCandidate {
  runtimeId: string;
}

export function resolveRuntimeSessionMatches(
  candidateSets: readonly RuntimeSessionCandidateSet[]
): RuntimeSessionMatch[] {
  const remaining = new Map(
    candidateSets.map(({ runtimeId, candidates }) => [
      runtimeId,
      new Map(candidates.map((candidate) => [candidate.sessionId, candidate]))
    ])
  );
  const matches: RuntimeSessionMatch[] = [];

  while (remaining.size > 0) {
    const singletonClaims = new Map<
      string,
      Array<{ runtimeId: string; candidate: RuntimeSessionCandidate }>
    >();
    for (const [runtimeId, candidates] of remaining) {
      if (candidates.size !== 1) continue;
      const candidate = candidates.values().next()
        .value as RuntimeSessionCandidate;
      const claims = singletonClaims.get(candidate.sessionId) ?? [];
      claims.push({ runtimeId, candidate });
      singletonClaims.set(candidate.sessionId, claims);
    }

    const accepted = [...singletonClaims.values()]
      .filter((claims) => claims.length === 1)
      .map((claims) => claims[0]!);
    if (accepted.length === 0) break;

    const assignedSessionIds = new Set<string>();
    for (const { runtimeId, candidate } of accepted) {
      matches.push({ runtimeId, ...candidate });
      remaining.delete(runtimeId);
      assignedSessionIds.add(candidate.sessionId);
    }
    for (const candidates of remaining.values()) {
      for (const sessionId of assignedSessionIds) {
        candidates.delete(sessionId);
      }
    }
  }

  return matches;
}
