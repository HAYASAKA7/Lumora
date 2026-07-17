export function copilotEvent(
  overrides: Record<string, unknown> = {}
): string {
  return JSON.stringify({
    type: 'session.start',
    id: 'event-1',
    timestamp: '2026-07-11T01:00:00.000Z',
    data: {
      context: { cwd: '/work/lumora' },
      name: 'Initial session name'
    },
    ...overrides
  });
}
