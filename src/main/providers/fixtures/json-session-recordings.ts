export function jsonSessionRecording(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    sessionId: '11111111-1111-4111-8111-111111111111',
    summary: 'Refine catalog adapters',
    startTime: '2026-07-11T01:00:00.000Z',
    messages: [
      { timestamp: '2026-07-11T01:05:00.000Z', content: 'private prompt' },
      { timestamp: '2026-07-11T01:10:00.000Z', content: 'private response' }
    ],
    ...overrides
  };
}
