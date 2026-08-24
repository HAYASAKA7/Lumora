import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture(source: string): string {
  const root = mkdtempSync(join(tmpdir(), 'lumora-string-gate-'));
  temporaryRoots.push(root);
  const path = join(root, 'Fixture.tsx');
  writeFileSync(path, source, 'utf8');
  return path;
}

function scanner(): {
  scanFiles(paths: string[]): Array<{ kind: string; text: string }>;
} {
  return require('./check-renderer-strings.cjs');
}

describe('localization source-string gate', () => {
  it('detects JSX text, visible attributes, authored errors, menu labels, and interpolation', () => {
    const path = fixture(`
      export function Bad({ name }: { name: string }) {
        const menu = { label: 'Open Lumora' };
        if (!name) throw new Error('Choose a session first.');
        return <button title="Start session" aria-label="Start session"
          placeholder="Type a prompt">Welcome {name}!</button>;
      }
    `);

    expect(scanner().scanFiles([path]).map((issue) => issue.kind)).toEqual(
      expect.arrayContaining([
        'jsx-text',
        'visible-attribute',
        'authored-error',
        'menu-label',
        'jsx-interpolation'
      ])
    );
  });

  it('allows localization keys, technical literals, commands, paths, URLs, and logs', () => {
    const path = fixture(`
      const className = 'terminal-card';
      const command = 'npm --version';
      const pathValue = '/home/user/.codex';
      const url = 'https://example.com';
      const code = 'TERMINAL_OPERATION_FAILED';
      console.error('[Lumora diagnostic]', code);
      export const Good = () => <button className={className}>{t('common.actions.open')}</button>;
    `);

    expect(scanner().scanFiles([path])).toEqual([]);
  });
});
