import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  assertContainedPath,
  assertRegularFile,
  assertSafeArchiveEntryName,
} from './transfer-path-safety';

describe('transfer path safety', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'lumora-transfer-path-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it.each(['../secret', '/absolute', 'C:/absolute', 'a\\b', 'a/../b', 'a//b', '.'])('rejects unsafe archive entry %s', (name) => {
    expect(() => assertSafeArchiveEntryName(name)).toThrow();
  });

  it('contains normalized entry paths under staging', () => {
    expect(assertSafeArchiveEntryName('providers/opencode/session.json')).toBe(
      'providers/opencode/session.json'
    );
    expect(assertContainedPath(root, 'providers/opencode/session.json')).toBe(
      join(root, 'providers', 'opencode', 'session.json')
    );
  });

  it('rejects symbolic links as archive sources', async () => {
    const target = join(root, 'target');
    const link = join(root, 'link');
    await mkdir(target);
    await writeFile(join(target, 'session.json'), '{}');
    await symlink(target, link, 'junction');
    await expect(assertRegularFile(link)).rejects.toMatchObject({
      code: 'ARCHIVE_SOURCE_NOT_REGULAR'
    });
  });

  it('rejects a symlinked staging ancestor', async () => {
    const outside = join(root, 'outside');
    const staging = join(root, 'staging');
    await mkdir(outside);
    await symlink(outside, staging, 'junction');
    expect(() => assertContainedPath(staging, 'session.json')).toThrow();
  });
});
