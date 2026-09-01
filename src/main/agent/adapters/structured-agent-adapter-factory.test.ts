import { describe, expect, it, vi } from 'vitest';

import type { StructuredAgentProviderId } from '../../../shared/agent/contracts';
import type {
  StructuredAgentAdapter,
  StructuredAgentAdapterContext
} from './structured-agent-adapter';
import { createStructuredAgentAdapterFactory } from './structured-agent-adapter-factory';

function context(providerId: StructuredAgentProviderId): StructuredAgentAdapterContext {
  return {
    connectionId: `connection-${providerId}`,
    providerId,
    generation: 1,
    launch: {
      request: {
        strategy: 'new',
        providerId,
        workspaceId: 'workspace-1',
        startPrompt: ''
      },
      workspaceId: 'workspace-1',
      catalogSessionId: null,
      nativeSessionId: null,
      title: 'Session',
      workingDirectory: 'C:\\workspace',
      executablePath: `C:\\tools\\${providerId}.cmd`
    },
    callbacks: { emit: vi.fn(), exited: vi.fn() }
  };
}

function adapter(): StructuredAgentAdapter {
  return {
    open: vi.fn(async () => ({ nativeSessionId: 'native-1' })),
    dispatch: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined)
  };
}

describe('structured agent adapter factory', () => {
  it.each([
    'codex',
    'claude',
    'gemini',
    'opencode',
    'cursor',
    'copilot',
    'qwen',
    'kimi',
    'goose'
  ] as const)(
    'routes %s to its dedicated adapter without changing launch identity',
    async (providerId) => {
      const selected = adapter();
      const creators = {
        codex: vi.fn(() => selected),
        claude: vi.fn(() => selected),
        gemini: vi.fn(() => selected),
        opencode: vi.fn(() => selected),
        cursor: vi.fn(() => selected),
        copilot: vi.fn(() => selected),
        qwen: vi.fn(() => selected),
        kimi: vi.fn(() => selected),
        goose: vi.fn(() => selected)
      };
      const factory = createStructuredAgentAdapterFactory(creators);
      const current = context(providerId);

      await expect(factory(current)).resolves.toBe(selected);
      expect(creators[providerId]).toHaveBeenCalledWith(current);
      for (const [otherProvider, creator] of Object.entries(creators)) {
        if (otherProvider !== providerId) expect(creator).not.toHaveBeenCalled();
      }
    }
  );
});
