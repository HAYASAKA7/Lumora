import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const readmePath = new URL('../../../README.md', import.meta.url);
const packageJsonPath = new URL('../../../package.json', import.meta.url);
const releaseGuidePath = new URL('../../../docs/RELEASING.md', import.meta.url);
const troubleshootingGuidePath = new URL(
  '../../../docs/TROUBLESHOOTING.md',
  import.meta.url
);
const providerSupportPath = new URL(
  '../../../docs/PROVIDER_SUPPORT.md',
  import.meta.url
);
const userGuidePath = new URL('../../../docs/USER_GUIDE.md', import.meta.url);
const unifiedUiGuidePath = new URL('../../../docs/UNIFIED_UI.md', import.meta.url);
const settingsGuidePath = new URL('../../../docs/SETTINGS.md', import.meta.url);

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
      'docs/screenshots/0.5/core/home.png',
      'docs/USER_GUIDE.md',
      'docs/UNIFIED_UI.md',
      'docs/SETTINGS.md',
      'docs/ARCHITECTURE.md',
      'docs/DEVELOPMENT.md',
      'docs/RELEASING.md',
      'CHANGELOG.md'
    ]) {
      expect(readme).toContain(documentation);
    }

    expect(readme).toMatch(
      /<p align="center">\s*<img[^>]+alt="Lumora logo"[^>]+>\s*<\/p>/
    );
    expect(readme).not.toContain('## Build locally');
    expect(readme).not.toContain('## Create the draft prerelease');
    expect(readme).not.toContain('## Managed terminals');
    expect(readme.split('\n').length).toBeLessThan(400);

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

  it('keeps detailed user workflows in focused guides with current screenshots', async () => {
    const [userGuide, unifiedUiGuide, settingsGuide, homeScreenshot, conversationScreenshot] =
      await Promise.all([
        readFile(userGuidePath, 'utf8'),
        readFile(unifiedUiGuidePath, 'utf8'),
        readFile(settingsGuidePath, 'utf8'),
        readFile(new URL('../../../docs/screenshots/0.5/core/home.png', import.meta.url)),
        readFile(
          new URL(
            '../../../docs/screenshots/0.5/unified-ui/unified_ui_conversation.png',
            import.meta.url
          )
        )
      ]);

    for (const documentation of [
      '# Using Lumora',
      '## Workspaces',
      '## Saved sessions',
      '## Managed native terminals',
      '| `Ctrl+Shift+L` | Collapse or expand the sidebar |',
      'screenshots/0.5/core/session_context_menu.png'
    ]) {
      expect(userGuide).toContain(documentation);
    }

    for (const documentation of [
      '# Lumora Unified UI',
      '## Supported integrations',
      '## Commands and models',
      '## Process, tools, approvals, and file changes',
      '## Lifecycle and fallback',
      'screenshots/0.5/unified-ui/unified_ui_activity.png'
    ]) {
      expect(unifiedUiGuide).toContain(documentation);
    }

    for (const documentation of [
      '# Lumora settings and customization',
      '## General',
      '## Appearance',
      '## Mods',
      '## Providers',
      '## Diagnostics',
      'screenshots/0.5/settings/settings_about.png'
    ]) {
      expect(settingsGuide).toContain(documentation);
    }

    expect(homeScreenshot.byteLength).toBeGreaterThan(0);
    expect(conversationScreenshot.byteLength).toBeGreaterThan(0);
  });

  it('documents the controlled Lumora draft prerelease process', async () => {
    const [releaseGuide, packageJsonText] = await Promise.all([
      readFile(releaseGuidePath, 'utf8'),
      readFile(packageJsonPath, 'utf8')
    ]);
    const packageVersion = (JSON.parse(packageJsonText) as { version: string }).version;

    for (const documentation of [
      '## Create the draft prerelease',
      'Product name: **Lumora**',
      'Author: **HAYASAKA7**',
      `git tag v${packageVersion}`,
      `git push origin v${packageVersion}`,
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
  it('documents safe provider-native cross-device session transfer', async () => {
    const [readme, transferGuide, architecture, providerSupport, troubleshooting, releaseGuide] =
      await Promise.all([
        readFile(readmePath, 'utf8'),
        readFile(new URL('../../../docs/SESSION_TRANSFER.md', import.meta.url), 'utf8'),
        readFile(new URL('../../../docs/ARCHITECTURE.md', import.meta.url), 'utf8'),
        readFile(providerSupportPath, 'utf8'),
        readFile(troubleshootingGuidePath, 'utf8'),
        readFile(releaseGuidePath, 'utf8')
      ]);

    expect(readme).toContain('docs/SESSION_TRANSFER.md');
    for (const documentation of [
      '# Move sessions between devices',
      '## What an archive contains',
      '## Export stopped sessions',
      '## Import an archive',
      'mixed-provider archive',
      'Map workspaces',
      'Duplicate sessions are skipped',
      'Verification pending',
      'TROUBLESHOOTING.md'
    ]) {
      expect(transferGuide).toContain(documentation);
    }
    expect(architecture).toContain('provider-owned session files');
    expect(architecture).toContain('never transfers provider credentials');
    expect(providerSupport).toContain('## Cross-device transfer verification');
    expect(providerSupport).toContain(
      '| Kimi Code | Implemented; native session directory and append-only index |'
    );
    expect(providerSupport).toContain('The seven implemented adapters');
    expect(troubleshooting).toContain('## Cross-device session transfer');
    expect(releaseGuide).toContain('record-transfer-verification.cjs');
    expect(releaseGuide).toContain('Never edit the verified route table by hand');
  });

  it('documents local privacy-safe diagnostics and support export', async () => {
    const [readme, architecture, troubleshooting, development, changelog] =
      await Promise.all([
        readFile(readmePath, 'utf8'),
        readFile(new URL('../../../docs/ARCHITECTURE.md', import.meta.url), 'utf8'),
        readFile(troubleshootingGuidePath, 'utf8'),
        readFile(new URL('../../../docs/DEVELOPMENT.md', import.meta.url), 'utf8'),
        readFile(new URL('../../../CHANGELOG.md', import.meta.url), 'utf8')
      ]);

    expect(readme).toContain('Settings > Diagnostics');
    expect(architecture).toContain('bounded diagnostic journal');
    expect(architecture).toContain('never contains prompts');
    expect(troubleshooting).toContain('## Diagnostics and abnormal shutdown');
    expect(troubleshooting).toContain('Export diagnostics');
    expect(development).toContain('diagnostic journal');
    expect(development).toContain('npm run benchmark');
    expect(changelog).toContain('privacy-safe local diagnostics');
  });
});
