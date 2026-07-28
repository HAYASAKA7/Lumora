import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const readmePath = new URL('../../../README.md', import.meta.url);
const releaseGuidePath = new URL('../../../docs/RELEASING.md', import.meta.url);
const troubleshootingGuidePath = new URL(
  '../../../docs/TROUBLESHOOTING.md',
  import.meta.url
);
const providerSupportPath = new URL(
  '../../../docs/PROVIDER_SUPPORT.md',
  import.meta.url
);

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
      'docs/screenshots/home_sidebar_expanded.png',
      '| `Ctrl+Shift+L` | Collapse or expand the sidebar |',
      'docs/ARCHITECTURE.md',
      'docs/DEVELOPMENT.md',
      'docs/RELEASING.md'
    ]) {
      expect(readme).toContain(documentation);
    }

    expect(readme).toMatch(
      /<p align="center">\s*<img[^>]+alt="Lumora logo"[^>]+>\s*<\/p>/
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

  it('keeps maintainable troubleshooting guidance outside the user guide', async () => {
    const [readme, troubleshootingGuide] = await Promise.all([
      readFile(readmePath, 'utf8'),
      readFile(troubleshootingGuidePath, 'utf8')
    ]);

    expect(readme).toContain('docs/TROUBLESHOOTING.md');
    expect(readme).not.toContain('## Troubleshooting');

    for (const documentation of [
      '# Troubleshooting Lumora',
      '## Quick checks',
      '## Installation and startup',
      '## Provider discovery',
      '## Workspaces and saved sessions',
      '## Managed terminals',
      '## Development builds',
      '## Report an unresolved problem',
      'Symptom',
      'Resolution'
    ]) {
      expect(troubleshootingGuide).toContain(documentation);
    }
  });

  it('documents honest provider capabilities and cross-platform verification', async () => {
    const [readme, developmentGuide, providerSupport] = await Promise.all([
      readFile(readmePath, 'utf8'),
      readFile(new URL('../../../docs/DEVELOPMENT.md', import.meta.url), 'utf8'),
      readFile(providerSupportPath, 'utf8')
    ]);

    expect(readme).toContain('docs/PROVIDER_SUPPORT.md');
    expect(developmentGuide).toContain('PROVIDER_SUPPORT.md');
    for (const documentation of [
      '# Provider support and verification',
      '| Provider | Support level | Windows | macOS | Linux |',
      'Full session support',
      'Launch only',
      'Pending manual verification',
      'Automated coverage is not a real CLI smoke test',
      'Cursor CLI',
      'Antigravity',
      'Codex',
      'Claude Code',
      'Gemini CLI',
      'OpenCode',
      'GitHub Copilot CLI',
      'Qwen Code',
      'Amp',
      'Crush',
      'goose',
      'Aider',
      'cursor-agent ls',
      'last_conversations.json'
    ]) {
      expect(providerSupport).toContain(documentation);
    }
  });
});
