import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const readmePath = new URL('../../../README.md', import.meta.url);

describe('unsigned MVP release documentation', () => {
  it('documents native packages, unsigned warnings, and manual acceptance', async () => {
    const readme = await readFile(readmePath, 'utf8');

    const requiredDocumentation = [
      '## Package an unsigned MVP build',
      'npm run package:dir',
      'Unsigned MVP packages',
      'verifies and uploads all four artifacts',
      '14 days',
      'Open the completed workflow run',
      'Artifacts section',
      'download the artifact for your platform',
      'Windows x64',
      'Linux x64',
      'macOS Intel x64',
      'macOS Apple Silicon arm64',
      'SmartScreen',
      'Gatekeeper',
      '| Qwen Code | Confirmed npm action | Yes | Yes | Yes |',
      'provider-owned sessions',
      'custom CLI start command',
      'session tab closes automatically'
    ];

    for (const documentation of requiredDocumentation) {
      expect(readme).toContain(documentation);
    }

    expect(readme).toMatch(/^npm run package$/m);
  });
});
