/**
 * Search in Settings. Each setting row on the page carries a marker, and one
 * pass over the rendered page decides which rows match. The panels hold no
 * search logic of their own.
 *
 * Markers, all optional apart from `data-setting`:
 * - `data-setting="<label key>"` on a row. The key also finds the row's English
 *   name, so a search in English works whatever the language.
 * - `data-setting-description="<description key>"` on a row.
 * - `data-setting-modified` on a row whose value differs from its default.
 * - `data-setting-group="<title key>"` on a group of rows. A search that names
 *   the group finds every row in it.
 * - `data-settings-category="<category>"` on each category panel, which the
 *   match counts are kept by.
 * - `data-setting-companion` on something that belongs with a panel's rows,
 *   such as its Save button: it shows whenever its panel shows results.
 *
 * `setting-block` wraps the sibling parts of one setting without adding a box
 * of its own, so they match and count as one.
 */

import { createContext } from 'react';

import englishProviders from '../../../../resources/locales/en/providers.json';
import englishSettings from '../../../../resources/locales/en/settings.json';
import englishTerminal from '../../../../resources/locales/en/terminal.json';
import englishTransfer from '../../../../resources/locales/en/transfer.json';

/** Typed in the box it does what the Modified toggle does, as in VS Code. */
export const MODIFIED_TOKEN = '@modified';

/** Set on a row that does not match; React never renders it, so it is never overwritten. */
export const SEARCH_MISS_ATTRIBUTE = 'data-search-miss';

/**
 * Whether a search is on. A panel that renders some of its rows only on
 * request, such as a collapsed section, renders them all while it is.
 */
export const SettingsSearchingContext = createContext(false);

export interface SettingsQuery {
  /** Lowercased words, every one of which a row must match. */
  terms: readonly string[];
  modifiedOnly: boolean;
}

type LocaleTree = { readonly [key: string]: string | LocaleTree };

const ENGLISH_NAMESPACES: Readonly<Record<string, LocaleTree>> = {
  providers: englishProviders,
  settings: englishSettings,
  terminal: englishTerminal,
  transfer: englishTransfer
};

/** The English text of a message key, or '' when English has none. */
export function englishText(key: string): string {
  const [namespace, ...path] = key.split('.');
  let node: string | LocaleTree | undefined = namespace === undefined
    ? undefined
    : ENGLISH_NAMESPACES[namespace];
  for (const part of path) {
    if (node === undefined || typeof node === 'string') return '';
    node = node[part];
  }
  return typeof node === 'string' ? node : '';
}

export function parseSettingsQuery(text: string): SettingsQuery {
  const words = text.toLowerCase().split(/\s+/u).filter(Boolean);
  return {
    terms: words.filter((word) => word !== MODIFIED_TOKEN),
    modifiedOnly: words.includes(MODIFIED_TOKEN)
  };
}

/** The query text with `@modified` added or taken out, so the toggle and the box agree. */
export function withModifiedToken(text: string, modifiedOnly: boolean): string {
  const words = text.split(/\s+/u).filter(
    (word) => word.length > 0 && word.toLowerCase() !== MODIFIED_TOKEN
  );
  return (modifiedOnly ? [MODIFIED_TOKEN, ...words] : words).join(' ') + (
    modifiedOnly && words.length === 0 ? ' ' : ''
  );
}

export function isSearching(query: SettingsQuery): boolean {
  return query.terms.length > 0 || query.modifiedOnly;
}

/** Shortcuts compare without spaces or `+`, so `ctrl+f` finds `Ctrl + F`. */
function compact(text: string): string {
  return text.replace(/[\s+]/gu, '');
}

/** Whether every word matches somewhere in the row's text. */
export function textMatches(haystack: string, terms: readonly string[]): boolean {
  const text = haystack.toLowerCase();
  return terms.every((term) =>
    text.includes(term) || (term.includes('+') && compact(text).includes(compact(term)))
  );
}

/** Everything a row can be found by: what it shows, what it holds and its English name. */
export function rowText(row: HTMLElement, translate: (key: string) => string): string {
  const parts = [row.textContent ?? ''];
  for (const field of row.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')) {
    if (field instanceof HTMLInputElement && (field.type === 'checkbox' || field.type === 'radio')) continue;
    parts.push(field.value);
  }
  const keys = [row.dataset.setting, row.dataset.settingDescription];
  const group = row.closest<HTMLElement>('[data-setting-group]')?.dataset.settingGroup;
  if (group !== undefined && group.length > 0) keys.push(group);
  for (const key of keys) {
    if (key === undefined || key.length === 0) continue;
    // A translation that needs values it was not given comes back as its key.
    const translated = translate(key);
    if (translated !== key) parts.push(translated);
    parts.push(englishText(key));
  }
  return parts.join('\n');
}

/**
 * Marks the rows under `root` that do not match and counts the ones that do, by
 * category. An empty query clears every mark.
 */
export function applySettingsSearch(
  root: HTMLElement,
  query: SettingsQuery,
  translate: (key: string) => string
): Record<string, number> {
  const counts: Record<string, number> = {};
  const searching = isSearching(query);
  for (const row of root.querySelectorAll<HTMLElement>('[data-setting]')) {
    const matches = !searching || (
      (!query.modifiedOnly || row.hasAttribute('data-setting-modified')) &&
      textMatches(rowText(row, translate), query.terms)
    );
    if (matches) row.removeAttribute(SEARCH_MISS_ATTRIBUTE);
    else row.setAttribute(SEARCH_MISS_ATTRIBUTE, '');
    const category = row.closest<HTMLElement>('[data-settings-category]')?.dataset.settingsCategory;
    if (matches && category !== undefined) counts[category] = (counts[category] ?? 0) + 1;
  }
  return counts;
}

/** Spread onto a setting row: `<label {...settingMarker('settings.x', 'settings.x-description')}>`. */
export function settingMarker(
  labelKey: string,
  descriptionKey?: string,
  modified?: boolean
): Record<string, string | undefined> {
  return {
    'data-setting': labelKey,
    'data-setting-description': descriptionKey,
    'data-setting-modified': modified === true ? '' : undefined
  };
}

/** Spread onto a group of setting rows. */
export function settingGroupMarker(titleKey: string): Record<string, string> {
  return { 'data-setting-group': titleKey };
}
