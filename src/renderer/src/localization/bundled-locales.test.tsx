import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { LocalizationSnapshot } from '../../../shared/contracts';
import { renderWithLocalization } from '../test/render-with-localization';
import { useLocalization } from './useLocalization';

const LOCALES = ['en', 'zh-Hans', 'zh-Hant', 'ja', 'ko'] as const;
const NAMESPACES = [
  'common',
  'shell',
  'catalog',
  'terminal',
  'settings',
  'providers',
  'remote',
  'transfer',
  'errors'
] as const;

function flatten(
  namespace: string,
  value: unknown,
  output: Record<string, string>,
  path: string[] = []
): void {
  if (typeof value === 'string') {
    output[`${namespace}.${path.join('.')}`] = value;
    return;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
  for (const [key, child] of Object.entries(value)) {
    flatten(namespace, child, output, [...path, key]);
  }
}

function snapshot(locale: typeof LOCALES[number]): LocalizationSnapshot {
  const root = resolve(process.cwd(), 'resources/locales', locale);
  const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8')) as {
    displayName: string;
    direction: 'ltr' | 'rtl';
    catalogVersion: number;
  };
  const messages: Record<string, string> = {};
  for (const namespace of NAMESPACES) {
    flatten(
      namespace,
      JSON.parse(readFileSync(resolve(root, `${namespace}.json`), 'utf8')),
      messages
    );
  }
  return {
    revision: 1,
    preference: locale,
    locale,
    formattingLocale: locale,
    direction: manifest.direction,
    availableLocales: [{
      locale,
      displayName: manifest.displayName,
      direction: manifest.direction,
      sources: ['bundled'],
      catalogVersion: manifest.catalogVersion
    }],
    messages,
    warnings: []
  };
}

function LocaleSmokeProbe() {
  const { snapshot, t } = useLocalization();
  return (
    <main data-testid="locale" data-locale={snapshot.locale}>
      <span>{t('shell.navigation.home')}</span>
      <span>{t('catalog.sessions.title')}</span>
      <span>{t('terminal.actions.stop-terminal')}</span>
      <span>{t('settings.tabs.general')}</span>
      <span>{t('providers.title')}</span>
      <span>{t('remote.targets.title')}</span>
      <span>{t('transfer.title')}</span>
      <span>{t('errors.general.title')}</span>
      <span>{t('common.actions.cancel')}</span>
    </main>
  );
}

describe('bundled locale renderer smoke tests', () => {
  for (const locale of LOCALES) {
    it(`renders representative messages in ${locale}`, () => {
      const localeSnapshot = snapshot(locale);
      const { unmount } = renderWithLocalization(
        <LocaleSmokeProbe />,
        localeSnapshot
      );

      expect(screen.getByTestId('locale')).toHaveAttribute('data-locale', locale);
      expect(screen.getByTestId('locale')).not.toHaveTextContent(
        /(?:shell|catalog|terminal|settings|providers|remote|transfer|errors|common)\./
      );
      unmount();
    });
  }
});
