import { createContext, useContext } from 'react';

import type { LocalizationSnapshot } from '../../../shared/contracts';
import {
  createLocalizationFormatter,
  type TranslationValues
} from './format';

export type LocalizationContextValue = ReturnType<
  typeof createLocalizationFormatter
> & { snapshot: LocalizationSnapshot };

export const LocalizationContext = createContext<LocalizationContextValue | null>(null);

export function createLocalizationValue(
  snapshot: LocalizationSnapshot
): LocalizationContextValue {
  return { snapshot, ...createLocalizationFormatter(snapshot) };
}

export function useLocalization(): LocalizationContextValue {
  const value = useContext(LocalizationContext);
  if (value === null) {
    throw new Error('LocalizationProvider is required.'); // i18n-ignore: internal invariant
  }
  return value;
}

export type { TranslationValues };
