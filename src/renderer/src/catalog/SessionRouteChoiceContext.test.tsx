import { act, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type {
  StructuredProviderCapabilityReport,
  StructuredProviderPreference
} from '../../../shared/contracts';
import {
  STRUCTURED_PREFERENCES_CHANGED_EVENT,
  SessionRouteChoiceProvider,
  useSessionRouteChoice
} from './SessionRouteChoiceContext';

const preferences = (enabled: boolean): StructuredProviderPreference[] => [{
  providerId: 'codex',
  useUnifiedWhenAvailable: enabled,
  executablePathOverride: null
}, {
  providerId: 'claude',
  useUnifiedWhenAvailable: true,
  executablePathOverride: null
}, {
  providerId: 'gemini',
  useUnifiedWhenAvailable: true,
  executablePathOverride: null
}];

function report(
  state: StructuredProviderCapabilityReport['state'] = 'verified',
  resumeSession = true
): StructuredProviderCapabilityReport {
  const base = {
    providerId: 'codex' as const,
    integration: 'codex_app_server' as const,
    checkedAt: '2026-09-01T00:00:00.000Z',
    version: '1.0.0'
  };
  if (state === 'verified') {
    return {
      ...base,
      state,
      capabilities: {
        newSession: true,
        resumeSession,
        history: true,
        streaming: true,
        toolActivity: true,
        approvals: true,
        cancellation: true,
        usage: true,
        attachments: false
      },
      issue: null
    };
  }
  return {
    ...base,
    state,
    capabilities: null,
    issue: {
      code: 'STRUCTURED_PROBE_FAILED',
      message: 'Probe failed.',
      recovery: 'Use PTY.',
      retryable: true
    }
  } as StructuredProviderCapabilityReport;
}

function harness(options: {
  enabled?: boolean;
  capability?: StructuredProviderCapabilityReport;
} = {}) {
  const api = {
    getStructuredProviderPreferences: vi.fn().mockResolvedValue(
      preferences(options.enabled ?? true)
    ),
    scanStructuredProviderCapabilities: vi.fn().mockResolvedValue([
      options.capability ?? report()
    ])
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionRouteChoiceProvider api={api}>
      {children}
    </SessionRouteChoiceProvider>
  );
  return { api, wrapper };
}

describe('SessionRouteChoiceProvider', () => {
  it('loads preferences cheaply and resolves capabilities lazily once', async () => {
    const { api, wrapper } = harness();
    const { result } = renderHook(() => useSessionRouteChoice('codex'), {
      wrapper
    });

    await waitFor(() => expect(result.current.visibility).toBe('visible'));
    expect(result.current).toMatchObject({ state: 'checking' });
    expect(api.scanStructuredProviderCapabilities).not.toHaveBeenCalled();

    act(() => {
      result.current.resolve();
      result.current.resolve();
    });

    await waitFor(() => expect(result.current).toMatchObject({
      visibility: 'visible',
      state: 'available'
    }));
    expect(api.scanStructuredProviderCapabilities).toHaveBeenCalledTimes(1);
    expect(api.scanStructuredProviderCapabilities).toHaveBeenCalledWith(false);
  });

  it('hides Unified UI when the saved provider preference is disabled', async () => {
    const { api, wrapper } = harness({ enabled: false });
    const { result } = renderHook(() => useSessionRouteChoice('codex'), {
      wrapper
    });

    await waitFor(() => expect(result.current.visibility).toBe('hidden'));
    act(() => result.current.resolve());
    expect(api.scanStructuredProviderCapabilities).not.toHaveBeenCalled();
  });

  it('exposes bounded unavailable reasons without raw probe details', async () => {
    const { wrapper } = harness({ capability: report('verified', false) });
    const { result } = renderHook(() => useSessionRouteChoice('codex'), {
      wrapper
    });

    await waitFor(() => expect(result.current.visibility).toBe('visible'));
    act(() => result.current.resolve());
    await waitFor(() => expect(result.current).toMatchObject({
      state: 'unavailable',
      reason: 'resume_unsupported'
    }));
  });

  it('reloads preferences and invalidates capabilities after a settings save', async () => {
    const { api, wrapper } = harness();
    const { result } = renderHook(() => useSessionRouteChoice('codex'), {
      wrapper
    });
    await waitFor(() => expect(result.current.visibility).toBe('visible'));
    act(() => result.current.resolve());
    await waitFor(() => expect(result.current).toMatchObject({ state: 'available' }));

    api.getStructuredProviderPreferences.mockResolvedValue(preferences(false));
    act(() => window.dispatchEvent(
      new Event(STRUCTURED_PREFERENCES_CHANGED_EVENT)
    ));

    await waitFor(() => expect(result.current.visibility).toBe('hidden'));
    expect(api.getStructuredProviderPreferences).toHaveBeenCalledTimes(2);
  });

  it('keeps non-structured providers hidden', () => {
    const { wrapper } = harness();
    const { result } = renderHook(() => useSessionRouteChoice('opencode'), {
      wrapper
    });
    expect(result.current.visibility).toBe('hidden');
  });
});
