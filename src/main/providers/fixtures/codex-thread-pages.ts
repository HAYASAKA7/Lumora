export function codexThread(
  id: string,
  overrides: Readonly<Record<string, unknown>> = {}
): Readonly<Record<string, unknown>> {
  return {
    id,
    sessionId: id,
    ephemeral: false,
    cwd: '/work/lumora',
    createdAt: 1_720_000_000,
    updatedAt: 1_720_000_100,
    name: null,
    preview: 'fixture prompt text that must not be normalized',
    path: '/home/dev/.codex/sessions/private-rollout.jsonl',
    ...overrides
  };
}

export function codexThreadPage(
  data: readonly Readonly<Record<string, unknown>>[],
  nextCursor: string | null
): Readonly<Record<string, unknown>> {
  return { data, nextCursor, backwardsCursor: null };
}
