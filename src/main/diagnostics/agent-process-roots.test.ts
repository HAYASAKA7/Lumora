import { describe, expect, it } from 'vitest';

import { listAgentProcessRoots } from './agent-process-roots';

describe('agent process roots', () => {
  it('lists running terminal and unified agents with the process behind each', () => {
    expect(listAgentProcessRoots([
      { id: 'runtime-1', provider: 'claude', displayName: 'Refactor settings', state: 'running', pid: 300 },
      { id: 'runtime-2', provider: 'codex', displayName: 'Starting', state: 'launching', pid: null },
      { id: 'runtime-3', provider: 'codex', displayName: 'Finished', state: 'completed', pid: 301 }
    ], [
      { connectionId: 'connection-1', providerId: 'codex', title: 'Fix the build', state: 'ready', processId: 200 },
      { connectionId: 'connection-2', providerId: 'gemini', title: 'Opening', state: 'starting', processId: null },
      { connectionId: 'connection-3', providerId: 'claude', title: 'Failed', state: 'failed', processId: null }
    ])).toEqual([
      { id: 'runtime-1', provider: 'claude', surface: 'terminal', title: 'Refactor settings', processId: 300, starting: false },
      { id: 'runtime-2', provider: 'codex', surface: 'terminal', title: 'Starting', processId: null, starting: true },
      { id: 'connection-1', provider: 'codex', surface: 'unified', title: 'Fix the build', processId: 200, starting: false },
      { id: 'connection-2', provider: 'gemini', surface: 'unified', title: 'Opening', processId: null, starting: true }
    ]);
  });
});
