export function qwenSessionRecording(
  overrides: Record<string, unknown> = {}
): readonly string[] {
  const sessionId =
    typeof overrides.sessionId === 'string'
      ? overrides.sessionId
      : '33333333-3333-4333-8333-333333333333';
  const cwd = typeof overrides.cwd === 'string' ? overrides.cwd : '/work/qwen';
  return [
    JSON.stringify({
      uuid: '44444444-4444-4444-8444-444444444444',
      parentUuid: null,
      sessionId,
      timestamp: '2026-07-11T01:00:00.000Z',
      type: 'user',
      cwd,
      version: '0.19.11',
      message: { role: 'user', parts: [{ text: 'private prompt' }] },
      ...overrides
    }),
    JSON.stringify({
      uuid: '55555555-5555-4555-8555-555555555555',
      parentUuid: '44444444-4444-4444-8444-444444444444',
      sessionId,
      timestamp: '2026-07-11T01:10:00.000Z',
      type: 'system',
      subtype: 'custom_title',
      cwd,
      version: '0.19.11',
      systemPayload: {
        customTitle: 'Refine Qwen catalog adapter',
        titleSource: 'manual'
      }
    })
  ];
}
