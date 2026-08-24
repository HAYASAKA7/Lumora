import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { LocalizationSnapshot, LumoraApi } from '../../../shared/contracts';
import { LocalizationProvider } from './LocalizationProvider';
import { useLocalization } from './useLocalization';

const english: LocalizationSnapshot = {
  revision: 1,
  preference: 'system',
  locale: 'en',
  formattingLocale: 'en-US',
  direction: 'ltr',
  availableLocales: [{
    locale: 'en', displayName: 'English', direction: 'ltr',
    sources: ['bundled'], catalogVersion: 1
  }],
  messages: {
    'common.greeting': 'Hello, {name}',
    'common.files': '{count, plural, one {# file} other {# files}}'
  },
  warnings: []
};

function Probe() {
  const localization = useLocalization();
  return (
    <div>
      <span>{localization.t('common.greeting', { name: 'Lumora' })}</span>
      <span>{localization.t('common.files', { count: 2 })}</span>
      <span>{localization.formatNumber(12_345)}</span>
    </div>
  );
}

function apiHarness(initial: LocalizationSnapshot) {
  let listener: ((snapshot: LocalizationSnapshot) => void) | null = null;
  const unsubscribe = vi.fn();
  const api = {
    getLocalizationSnapshot: vi.fn().mockResolvedValue(initial),
    onLocalizationChanged: vi.fn((next) => {
      listener = next;
      return unsubscribe;
    })
  } as unknown as LumoraApi;
  return {
    api,
    publish(snapshot: LocalizationSnapshot) {
      const active = listener as unknown as (value: LocalizationSnapshot) => void;
      active(snapshot);
    },
    unsubscribe
  };
}

describe('LocalizationProvider', () => {
  it('loads and formats the initial snapshot', async () => {
    const { api } = apiHarness(english);
    render(
      <LocalizationProvider api={api}>
        <Probe />
      </LocalizationProvider>
    );

    expect(screen.getByTestId('localization-bootstrap')).toBeInTheDocument();
    expect(await screen.findByText('Hello, Lumora')).toBeInTheDocument();
    expect(screen.getByText('2 files')).toBeInTheDocument();
    expect(screen.getByText(new Intl.NumberFormat('en-US').format(12_345)))
      .toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('lang', 'en');
    expect(document.documentElement).toHaveAttribute('dir', 'ltr');
  });

  it('applies live locale and RTL metadata changes to the existing tree', async () => {
    const { api, publish } = apiHarness(english);
    render(
      <LocalizationProvider api={api}>
        <Probe />
      </LocalizationProvider>
    );
    await screen.findByText('Hello, Lumora');

    publish({
      ...english,
      revision: 2,
      preference: 'ar',
      locale: 'ar',
      formattingLocale: 'ar-EG',
      direction: 'rtl',
      messages: {
        'common.greeting': 'مرحبا، {name}',
        'common.files': '{count, plural, other {# ملفات}}'
      }
    });

    expect(await screen.findByText('مرحبا، Lumora')).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('lang', 'ar');
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(document.documentElement).toHaveAttribute('data-locale', 'ar');
  });

  it('removes the preload listener when unmounted', async () => {
    const { api, unsubscribe } = apiHarness(english);
    const view = render(
      <LocalizationProvider api={api}>
        <Probe />
      </LocalizationProvider>
    );
    await screen.findByText('Hello, Lumora');
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('shows a stable emergency English message when localization cannot load', async () => {
    const api = {
      getLocalizationSnapshot: vi.fn().mockRejectedValue(new Error('failed')),
      onLocalizationChanged: vi.fn(() => vi.fn())
    } as unknown as LumoraApi;
    render(
      <LocalizationProvider api={api}>
        <Probe />
      </LocalizationProvider>
    );
    await waitFor(() => {
      expect(screen.getByText('Language resources are unavailable.')).toBeInTheDocument();
    });
  });
});
