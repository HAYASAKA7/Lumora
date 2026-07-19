import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const readmePath = new URL('../../../README.md', import.meta.url);
const releaseGuidePath = new URL('../../../docs/RELEASING.md', import.meta.url);

describe('unsigned MVP release documentation', () => {
  it('keeps user installation guidance in README and maintainer steps in the release guide', async () => {
    const [readme, releaseGuide] = await Promise.all([
      readFile(readmePath, 'utf8'),
      readFile(releaseGuidePath, 'utf8')
    ]);

    for (const documentation of [
      '## Get Lumora',
      'GitHub Releases',
      'Windows x64',
      'Linux x64',
      'macOS Intel',
      'macOS Apple Silicon',
      'SmartScreen',
      'Gatekeeper',
      '| Qwen Code | Confirmed npm action | Yes | Yes |',
      'provider-owned sessions',
      '<h1 align="center">Lumora</h1>',
      'resources/icons/lumora/source/lumora-symbol-gradient.svg',
      '<!-- DEMO: Add docs/media/lumora-demo.mp4',
      'docs/ARCHITECTURE.md',
      'docs/DEVELOPMENT.md',
      'docs/RELEASING.md'
    ]) {
      expect(readme).toContain(documentation);
    }

    expect(readme).toMatch(
      /<p align="center">\s*<img[^>]+alt="Lumora"[^>]+>\s*<\/p>/
    );
    expect(readme).not.toContain('## Build locally');
    expect(readme).not.toContain('## Create the draft prerelease');

    for (const documentation of [
      '# Releasing Lumora',
      'npm run package:dir',
      'Unsigned MVP packages',
      '14 days',
      'Manual smoke-test checklist',
      'custom alias or wrapper command',
      'tab closes'
    ]) {
      expect(releaseGuide).toContain(documentation);
    }
  });

  it('documents the controlled Lumora draft prerelease process', async () => {
    const releaseGuide = await readFile(releaseGuidePath, 'utf8');

    for (const documentation of [
      '## Create the draft prerelease',
      'Product name: **Lumora**',
      'Author: **HAYASAKA7**',
      'git tag v0.1.0',
      'git push origin v0.1.0',
      'Lumora unsigned prerelease',
      'SHA256SUMS.txt',
      'draft prerelease',
      'Publish the draft manually'
    ]) {
      expect(releaseGuide).toContain(documentation);
    }
  });
});
