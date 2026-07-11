export function claudeLine(
  overrides: Readonly<Record<string, unknown>> = {}
): string {
  return JSON.stringify({
    type: 'file-history-snapshot',
    sessionId: '11111111-1111-4111-8111-111111111111',
    cwd: '/work/lumora',
    timestamp: '2026-07-11T01:00:00.000Z',
    ...overrides
  });
}
