import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const workflowPath = new URL('../../../.github/workflows/package.yml', import.meta.url);

function topLevelSection(workflow: string, name: string): string {
  const lines = workflow.split(/\r?\n/);
  const start = lines.indexOf(`${name}:`);

  if (start === -1) {
    return '';
  }

  const end = lines.findIndex(
    (line, index) => index > start && line.length > 0 && !/^\s/.test(line)
  );

  return lines.slice(start, end === -1 ? undefined : end).join('\n').trimEnd();
}

function matrixEntries(workflow: string): Array<Record<string, string>> {
  const lines = workflow.split(/\r?\n/);
  const includeIndex = lines.findIndex((line) => line.trim() === 'include:');

  if (includeIndex === -1) {
    return [];
  }

  const includeLine = lines[includeIndex];
  if (!includeLine) {
    return [];
  }

  const includeIndent = includeLine.search(/\S/);
  const entries: Array<Record<string, string>> = [];

  for (const line of lines.slice(includeIndex + 1)) {
    const indent = line.search(/\S/);
    if (line.trim() && indent <= includeIndent) {
      break;
    }

    const field = line.match(/^\s*(?:-\s+)?([a-z_]+):\s*(.+)$/);
    if (!field) {
      continue;
    }

    if (line.trimStart().startsWith('- ')) {
      entries.push({});
    }

    const fieldName = field[1];
    const fieldValue = field[2];
    const entry = entries.at(-1);
    if (fieldName && fieldValue !== undefined && entry) {
      entry[fieldName] = fieldValue;
    }
  }

  return entries;
}

describe('unsigned package workflow', () => {
  it('is manual, read-only, unsigned, and installs from the lockfile', async () => {
    const workflow = await readFile(workflowPath, 'utf8');
    const trigger = topLevelSection(workflow, 'on');
    const permissions = topLevelSection(workflow, 'permissions');
    const env = topLevelSection(workflow, 'env');

    expect(workflow).toMatch(/^name: Unsigned MVP packages$/m);
    expect(trigger).toBe('on:\n  workflow_dispatch:');
    expect(trigger).not.toMatch(/^\s+(?:push|pull_request):/m);
    expect(permissions).toBe('permissions:\n  contents: read');
    expect(workflow).not.toContain('contents: write');
    expect(env).toBe("env:\n  CSC_IDENTITY_AUTO_DISCOVERY: 'false'");

    expect(workflow).toContain('uses: actions/checkout@v7');
    expect(workflow).toMatch(
      /- uses: actions\/checkout@v7\r?\n\s+with:\r?\n\s+persist-credentials: false/
    );
    expect(workflow).toContain('uses: actions/setup-node@v6');
    expect(workflow).toContain('node-version-file: .nvmrc');
    expect(workflow).toContain('cache: npm');
    expect(workflow).toContain('run: npm ci');

    expect(workflow).not.toMatch(/\bGH_TOKEN\b/);
    expect(workflow).not.toMatch(/contents:\s*write/);
    expect(workflow).not.toMatch(/(?:--publish|^\s*publish:)/m);
    expect(workflow).not.toMatch(/(?:create-release|upload-release|release-action|action-gh-release)/i);
  });

  it('builds, verifies, and retains exactly four native packages', async () => {
    const workflow = await readFile(workflowPath, 'utf8');

    expect(workflow).toContain('name: Package (${{ matrix.label }})');
    expect(workflow).toContain('runs-on: ${{ matrix.runner }}');
    expect(workflow).toContain('timeout-minutes: 45');
    expect(workflow).toContain('fail-fast: false');
    expect(matrixEntries(workflow)).toEqual([
      {
        label: 'Windows x64',
        runner: 'windows-latest',
        platform: 'win',
        arch: 'x64',
        extension: 'exe',
        builder_args: '--win nsis --x64'
      },
      {
        label: 'Linux x64',
        runner: 'ubuntu-24.04',
        platform: 'linux',
        arch: 'x64',
        extension: 'AppImage',
        builder_args: '--linux AppImage --x64'
      },
      {
        label: 'macOS Apple Silicon',
        runner: 'macos-15',
        platform: 'mac',
        arch: 'arm64',
        extension: 'dmg',
        builder_args: '--mac dmg --arm64'
      },
      {
        label: 'macOS Intel',
        runner: 'macos-15-intel',
        platform: 'mac',
        arch: 'x64',
        extension: 'dmg',
        builder_args: '--mac dmg --x64'
      }
    ]);

    const orderedSteps = [
      'uses: actions/checkout@v7',
      'uses: actions/setup-node@v6',
      'run: npm ci',
      'run: npm run verify',
      'run: npx electron-builder ${{ matrix.builder_args }}',
      'run: node scripts/release/verify-package.cjs --platform ${{ matrix.platform }} --arch ${{ matrix.arch }}',
      'uses: actions/upload-artifact@v7'
    ];
    const positions = orderedSteps.map((step) => workflow.indexOf(step));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(workflow).toContain('name: lumora-${{ matrix.platform }}-${{ matrix.arch }}');
    expect(workflow).toContain(
      'path: dist/Lumora-*-${{ matrix.platform }}-${{ matrix.arch }}.${{ matrix.extension }}'
    );
    expect(workflow).toContain('if-no-files-found: error');
    expect(workflow).toContain('retention-days: 14');
  });
});
