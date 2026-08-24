import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

import type { LocalizationSnapshot } from '../../../shared/contracts';
import {
  createLocalizationValue,
  LocalizationContext
} from '../localization/useLocalization';

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
  messages: {},
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
