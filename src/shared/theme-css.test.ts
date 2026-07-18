import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(
  fileURLToPath(new URL('../renderer/src/styles.css', import.meta.url)),
  'utf8'
);

describe('Lumora theme', () => {
  it('uses logo-family cyan only for primary action buttons', () => {
    expect(styles).toContain('--button-cyan: #007d94');
    expect(styles).toContain('--button-cyan-hover: #006d82');
    expect(styles).toMatch(
      /\.refresh-button \{[\s\S]*background: var\(--button-cyan\);/
    );
    expect(styles).toMatch(
      /\.refresh-button:hover:not\(:disabled\) \{[\s\S]*background: var\(--button-cyan-hover\);/
    );
    expect(styles).toContain('--blue: #296dff');
    expect(styles).toContain('--blue-soft: #e9f0ff');
    expect(styles).not.toContain('--cyan-soft:');
  });
});
