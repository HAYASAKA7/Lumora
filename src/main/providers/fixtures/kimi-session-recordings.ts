interface KimiFixtureOptions {
  sessionId?: string;
  sessionDir?: string;
  workDir?: string;
  title?: string;
  lastPrompt?: string;
}

export function kimiIndexRecord({
  sessionId = 'session_123e4567-e89b-42d3-a456-426614174000',
  sessionDir = '/home/user/.kimi-code/sessions/wd_lumora/session_123e4567-e89b-42d3-a456-426614174000',
  workDir = '/work/lumora'
}: KimiFixtureOptions = {}): string {
  return JSON.stringify({ sessionId, sessionDir, workDir });
}

export function kimiState({
  title = 'Build Kimi support',
  lastPrompt = 'private prompt'
}: KimiFixtureOptions = {}): string {
  return JSON.stringify({
    title,
    lastPrompt,
    createdAt: '2026-08-12T01:00:00.000Z',
    updatedAt: '2026-08-12T02:00:00.000Z',
    forkedFrom: null
  });
}

export function kimiWire(): readonly string[] {
  return [
    JSON.stringify({ type: 'turn.prompt', content: 'private prompt', time: 1786500000000 }),
    JSON.stringify({
      type: 'usage.record',
      model: 'kimi-code/kimi-for-coding',
      usage: {
        inputOther: 1163,
        output: 352,
        inputCacheRead: 22272,
        inputCacheCreation: 17
      },
      usageScope: 'turn',
      time: 1786500001000
    })
  ];
}
