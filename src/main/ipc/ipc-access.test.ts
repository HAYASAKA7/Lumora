import { describe, expect, it } from 'vitest';

import { createWindowContextRegistry } from '../targets/window-context-registry';
import {
  IpcAccessError,
  createLocalIpcAuthorizer,
  type TargetAwareIpcEvent
} from './ipc-access';

const packagedEvent = (senderId: number): TargetAwareIpcEvent => ({
  sender: { id: senderId },
  senderFrame: { url: 'app://lumora/index.html' }
});

describe('createLocalIpcAuthorizer', () => {
  it('returns the registered local context for a trusted renderer', () => {
    const contexts = createWindowContextRegistry();
    contexts.register(7, {
      mode: 'local',
      executionTargetId: 'local'
    });
    const authorize = createLocalIpcAuthorizer({ contexts });

    expect(authorize(packagedEvent(7))).toEqual({
      mode: 'local',
      executionTargetId: 'local'
    });
  });

  it('accepts the configured development origin', () => {
    const contexts = createWindowContextRegistry();
    contexts.register(7, {
      mode: 'local',
      executionTargetId: 'local'
    });
    const authorize = createLocalIpcAuthorizer({
      contexts,
      developmentOrigin: 'http://localhost:5173'
    });

    expect(
      authorize({
        sender: { id: 7 },
        senderFrame: { url: 'http://localhost:5173/settings' }
      })
    ).toEqual({ mode: 'local', executionTargetId: 'local' });
  });

  it('rejects trusted URLs from unregistered sender IDs', () => {
    const authorize = createLocalIpcAuthorizer({
      contexts: createWindowContextRegistry()
    });

    expect(() => authorize(packagedEvent(8))).toThrow(IpcAccessError);
    expect(() => authorize(packagedEvent(8))).toThrow('IPC_UNTRUSTED_SENDER');
  });

  it('rejects events without an Electron sender identity', () => {
    const contexts = createWindowContextRegistry();
    contexts.register(7, { mode: 'local', executionTargetId: 'local' });
    const authorize = createLocalIpcAuthorizer({ contexts });

    expect(() => authorize({
      senderFrame: { url: 'app://lumora/index.html' }
    })).toThrow(IpcAccessError);
  });

  it('rejects missing frames and untrusted URLs', () => {
    const contexts = createWindowContextRegistry();
    contexts.register(7, {
      mode: 'local',
      executionTargetId: 'local'
    });
    const authorize = createLocalIpcAuthorizer({ contexts });

    expect(() =>
      authorize({ sender: { id: 7 }, senderFrame: null })
    ).toThrow(IpcAccessError);
    expect(() =>
      authorize({
        sender: { id: 7 },
        senderFrame: { url: 'https://example.com/' }
      })
    ).toThrow(IpcAccessError);
  });

  it('rejects remote target contexts from local-only IPC', () => {
    const contexts = createWindowContextRegistry();
    contexts.register(7, {
      mode: 'remote',
      executionTargetId: '4f632901-1f8d-44c0-8418-aa823f791ca0'
    });
    const authorize = createLocalIpcAuthorizer({ contexts });

    expect(() => authorize(packagedEvent(7))).toThrow(IpcAccessError);
  });
});
