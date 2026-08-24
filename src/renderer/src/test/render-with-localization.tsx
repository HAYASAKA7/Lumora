import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

import type { LocalizationSnapshot } from '../../../shared/contracts';
import catalog from '../../../../resources/locales/en/catalog.json';
import common from '../../../../resources/locales/en/common.json';
import errors from '../../../../resources/locales/en/errors.json';
import providers from '../../../../resources/locales/en/providers.json';
import remote from '../../../../resources/locales/en/remote.json';
import settings from '../../../../resources/locales/en/settings.json';
import shell from '../../../../resources/locales/en/shell.json';
import terminal from '../../../../resources/locales/en/terminal.json';
import transfer from '../../../../resources/locales/en/transfer.json';
import {
  createLocalizationValue,
  LocalizationContext
} from '../localization/useLocalization';

function flatten(
  namespace: string,
  input: unknown,
  output: Record<string, string>,
  segments: string[] = []
): void {
  if (typeof input === 'string') {
    output[`${namespace}.${segments.join('.')}`] = input;
    return;
  }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return;
  for (const [segment, value] of Object.entries(input)) {
    flatten(namespace, value, output, [...segments, segment]);
  }
}

const ENGLISH_MESSAGES: Record<string, string> = {};
for (const [namespace, messages] of Object.entries({
  catalog,
  common,
  errors,
  providers,
  remote,
  settings,
  shell,
  terminal,
  transfer
})) {
  flatten(namespace, messages, ENGLISH_MESSAGES);
}

export const TEST_LOCALIZATION_SNAPSHOT: LocalizationSnapshot = {
  revision: 1,
  preference: 'en',
  locale: 'en',
  formattingLocale: 'en-US',
  direction: 'ltr',
  availableLocales: [{
    locale: 'en', displayName: 'English', direction: 'ltr',
    sources: ['bundled'], catalogVersion: 1
  }],
  messages: ENGLISH_MESSAGES,
  warnings: []
};

export function renderWithLocalization(
  ui: ReactElement,
  snapshot: LocalizationSnapshot = TEST_LOCALIZATION_SNAPSHOT,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  const value = createLocalizationValue(snapshot);
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <LocalizationContext.Provider value={value}>
      {children}
    </LocalizationContext.Provider>
  );
  return render(ui, { ...options, wrapper: Wrapper });
}
