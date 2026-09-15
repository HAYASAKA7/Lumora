import { describe, expect, it } from 'vitest';

import { isContainedPath, mergeChangedFiles, parseNameStatus, parseNumstat } from './git-output';

describe('git -z output', () => {
  it('reads name-status entries including renames and non-ASCII names', () => {
    const output = Buffer.from('M\0a.txt\0R077\0b.txt\0空 格.txt\0A\0bin.dat\0D\0gone.txt\0', 'utf8');
    expect(parseNameStatus(output)).toEqual([
      { status: 'modified', path: 'a.txt', oldPath: null },
      { status: 'renamed', path: '空 格.txt', oldPath: 'b.txt' },
      { status: 'added', path: 'bin.dat', oldPath: null },
      { status: 'deleted', path: 'gone.txt', oldPath: null }
    ]);
  });

  it('reads numstat counts, binary files, and renames', () => {
    const output = Buffer.from('1\t0\ta.txt\0' + '-\t-\tbin.dat\0' + '0\t0\t\0b.txt\0空 格.txt\0', 'utf8');
    expect(parseNumstat(output)).toEqual(new Map([
      ['a.txt', { additions: 1, deletions: 0, binary: false }],
      ['bin.dat', { additions: null, deletions: null, binary: true }],
      ['空 格.txt', { additions: 0, deletions: 0, binary: false }]
    ]));
  });

  it('merges both into changed files sorted by path', () => {
    const files = mergeChangedFiles(
      [{ status: 'modified', path: 'z.txt', oldPath: null }, { status: 'added', path: 'a.bin', oldPath: null }],
      new Map([['z.txt', { additions: 2, deletions: 1, binary: false }], ['a.bin', { additions: null, deletions: null, binary: true }]])
    );
    expect(files.map(({ path }) => path)).toEqual(['a.bin', 'z.txt']);
    expect(files[1]).toEqual({ path: 'z.txt', oldPath: null, status: 'modified', additions: 2, deletions: 1, binary: false });
  });

  it('sorts by code unit so the order does not depend on the locale', () => {
    const files = mergeChangedFiles(
      [{ status: 'added', path: 'b.txt', oldPath: null }, { status: 'added', path: 'B.txt', oldPath: null }, { status: 'added', path: 'a.txt', oldPath: null }],
      new Map()
    );
    expect(files.map(({ path }) => path)).toEqual(['B.txt', 'a.txt', 'b.txt']);
  });

  it('keeps a numstat path whole instead of cutting it at a later tab', () => {
    const output = Buffer.from('1\t0\tname\twith-tab.txt\0' + '2\t0\tplain.txt\0', 'utf8');
    expect([...parseNumstat(output).keys()]).toEqual(['plain.txt']);
  });

  it('rejects paths containing control characters', () => {
    expect(isContainedPath('ok/file.txt')).toBe(true);
    expect(isContainedPath('..env')).toBe(true);
    for (const code of [0, 9, 10, 13, 31]) {
      expect(isContainedPath(`bad${String.fromCharCode(code)}name.txt`)).toBe(false);
    }
    expect(isContainedPath(`still${String.fromCharCode(32)}fine.txt`)).toBe(true);
  });

  it('ignores paths that would escape the workspace', () => {
    expect(parseNameStatus(Buffer.from('M\0../outside.txt\0M\0/abs.txt\0M\0ok.txt\0'))).toEqual([
      { status: 'modified', path: 'ok.txt', oldPath: null }
    ]);
  });
});
