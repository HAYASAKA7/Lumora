import { describe, expect, it } from 'vitest';

import {
  applySettingsSearch,
  englishText,
  parseSettingsQuery,
  textMatches,
  withModifiedToken
} from './settings-search';

/** A translation that stands in for another language: every key reads as Japanese. */
const translateToJapanese = (key: string) => ({
  'settings.general.start-maximized': '最大化して起動',
  'settings.general.startup-title': '起動とウィンドウ',
  'settings.appearance.theme': 'テーマ'
} as Record<string, string>)[key] ?? '';

function page(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

function shown(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>('[data-setting]:not([data-search-miss])')]
    .map((row) => row.dataset.setting!);
}

const SETTINGS = `
  <section data-settings-category="general">
    <section data-setting-group="settings.general.startup-title">
      <label data-setting="settings.general.start-maximized" data-setting-modified>
        <strong>最大化して起動</strong><input type="checkbox" checked>
      </label>
      <label data-setting="settings.general.warn-quit"><strong>終了前に確認</strong></label>
    </section>
  </section>
  <section data-settings-category="appearance">
    <div data-setting="settings.appearance.theme"><strong>テーマ</strong><button>Midnight</button></div>
    <div data-setting="settings.appearance.interface-font">
      <strong>フォント</strong><input type="text" value="Cascadia Code">
    </div>
  </section>
  <section data-settings-category="keyboard">
    <div data-setting="settings.shortcuts.focus-search"><strong>検索</strong><button>Ctrl+F</button></div>
  </section>`;

describe('parseSettingsQuery', () => {
  it('takes lowercased words and pulls @modified out of them', () => {
    expect(parseSettingsQuery('  Theme   @Modified dark ')).toEqual({
      terms: ['theme', 'dark'],
      modifiedOnly: true
    });
    expect(parseSettingsQuery('')).toEqual({ terms: [], modifiedOnly: false });
  });
});

describe('withModifiedToken', () => {
  it('keeps @modified in the box in step with the toggle', () => {
    expect(withModifiedToken('theme', true)).toBe('@modified theme');
    // Room to keep typing after the token.
    expect(withModifiedToken('', true)).toBe('@modified ');
    expect(withModifiedToken('@modified theme', false)).toBe('theme');
    expect(withModifiedToken('theme @MODIFIED dark', false)).toBe('theme dark');
    expect(withModifiedToken('@modified theme', true)).toBe('@modified theme');
  });
});

describe('textMatches', () => {
  it('needs every word, ignoring case', () => {
    expect(textMatches('Start maximized\nOpen the window full size', ['start', 'window'])).toBe(true);
    expect(textMatches('Start maximized', ['start', 'tray'])).toBe(false);
  });

  it('compares shortcut keys without spaces or plus signs', () => {
    expect(textMatches('Focus search Ctrl + F', ['ctrl+f'])).toBe(true);
    expect(textMatches('Focus search Ctrl+Shift+F', ['ctrl+shift+f'])).toBe(true);
    expect(textMatches('Focus search Ctrl+Shift+F', ['ctrl+f'])).toBe(false);
  });
});

describe('englishText', () => {
  it('finds the English text of a key and nothing for an unknown one', () => {
    expect(englishText('settings.tabs.general')).toBe('General');
    expect(englishText('settings.no-such-key')).toBe('');
    expect(englishText('nowhere.at.all')).toBe('');
  });
});

describe('applySettingsSearch', () => {
  it('finds a row by its name in the current language', () => {
    const root = page(SETTINGS);
    expect(applySettingsSearch(root, parseSettingsQuery('最大化'), translateToJapanese))
      .toEqual({ general: 1 });
    expect(shown(root)).toEqual(['settings.general.start-maximized']);
  });

  it('finds a row by its English name whatever the language', () => {
    const root = page(SETTINGS);
    applySettingsSearch(root, parseSettingsQuery('maximized'), translateToJapanese);
    expect(shown(root)).toEqual(['settings.general.start-maximized']);
  });

  it('finds a row by what it holds: a chosen option or text in a field', () => {
    const root = page(SETTINGS);
    applySettingsSearch(root, parseSettingsQuery('midnight'), translateToJapanese);
    expect(shown(root)).toEqual(['settings.appearance.theme']);
    applySettingsSearch(root, parseSettingsQuery('cascadia'), translateToJapanese);
    expect(shown(root)).toEqual(['settings.appearance.interface-font']);
  });

  it('finds a shortcut by its keys', () => {
    const root = page(SETTINGS);
    expect(applySettingsSearch(root, parseSettingsQuery('ctrl + f'), translateToJapanese))
      .toEqual({ keyboard: 1 });
  });

  it('finds every row of a group by the group title', () => {
    const root = page(SETTINGS);
    applySettingsSearch(root, parseSettingsQuery('起動とウィンドウ'), translateToJapanese);
    expect(shown(root)).toEqual([
      'settings.general.start-maximized',
      'settings.general.warn-quit'
    ]);
  });

  it('shows only settings changed from their defaults, alone or with words', () => {
    const root = page(SETTINGS);
    expect(applySettingsSearch(root, parseSettingsQuery('@modified'), translateToJapanese))
      .toEqual({ general: 1 });
    applySettingsSearch(root, parseSettingsQuery('@modified theme'), translateToJapanese);
    expect(shown(root)).toEqual([]);
  });

  it('matches nothing when a word is found nowhere, and clears every mark for no query', () => {
    const root = page(SETTINGS);
    expect(applySettingsSearch(root, parseSettingsQuery('zzz'), translateToJapanese)).toEqual({});
    expect(shown(root)).toEqual([]);

    applySettingsSearch(root, parseSettingsQuery(''), translateToJapanese);
    expect(root.querySelectorAll('[data-search-miss]')).toHaveLength(0);
  });
});
