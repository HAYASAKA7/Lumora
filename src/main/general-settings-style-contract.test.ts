import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/styles.css'),
  'utf8'
);

describe('General settings style contract', () => {
  it('renders a stable accessible switch with checked and focus states', () => {
    expect(stylesheet).toContain('.general-setting-card {');
    expect(stylesheet).toContain('.settings-switch-track {');
    expect(stylesheet).toContain(
      '.settings-switch input:checked + .settings-switch-track {'
    );
    expect(stylesheet).toContain(
      '.settings-switch input:focus-visible + .settings-switch-track {'
    );
    expect(stylesheet).toContain('.general-setting-error {');
  });
});
