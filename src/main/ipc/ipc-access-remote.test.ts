import { describe, expect, it } from 'vitest';

import { createWindowContextRegistry } from '../targets/window-context-registry';
import {
  IpcAccessError,
  createIpcAuthorizer,
  createLocalIpcAuthorizer,
  type TargetAwareIpcEvent
} from './ipc-access';

const event = (senderId: number): TargetAwareIpcEvent => ({
  sender: { id: senderId },
  senderFrame: { url: 'app://lumora/index.html' }
});

describe('target-aware IPC authorization', () => {
  it('returns immutable local and remote window contexts', () => {
    const contexts = createWindowContextRegistry();
    contexts.register(1, { mode: 'local', executionTargetId: 'local' });
    contexts.register(2, {
      mode: 'remote',
      executionTargetId: '4a89e60a-c789-4d6e-b305-6fe268b1943d'
    });
    const authorize = createIpcAuthorizer({ contexts });

    expect(authorize(event(1))).toEqual({
      mode: 'local', executionTargetId: 'local'
    });
    expect(authorize(event(2))).toEqual({
      mode: 'remote', executionTargetId: '4a89e60a-c789-4d6e-b305-6fe268b1943d'
    });
  });

  it('keeps local-only authorization as a strict wrapper', () => {
    const contexts = createWindowContextRegistry();
    contexts.register(2, {
      mode: 'remote',
      executionTargetId: '4a89e60a-c789-4d6e-b305-6fe268b1943d'
    });

    expect(() => createLocalIpcAuthorizer({ contexts })(event(2)))
      .toThrow(IpcAccessError);
  });
});
