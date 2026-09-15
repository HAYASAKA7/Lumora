import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DiffPatch, diffLineClass } from './DiffPatch';

describe('diffLineClass', () => {
  it.each([
    'diff --git a/a.txt b/a.txt',
    'index 1234567..89abcde 100644',
    '--- a/a.txt',
    '+++ b/a.txt',
    'new file mode 100644',
    'deleted file mode 100644',
    'rename from old.txt',
    'rename to new.txt',
    'similarity index 90%'
  ])('treats %s as metadata', (line) => {
    expect(diffLineClass(line)).toBe('structured-diff-metadata');
  });

  it('classifies hunks, additions, deletions and context', () => {
    expect(diffLineClass('@@ -1,2 +1,2 @@')).toBe('structured-diff-hunk');
    expect(diffLineClass('+added')).toBe('structured-diff-addition');
    expect(diffLineClass('-removed')).toBe('structured-diff-deletion');
    expect(diffLineClass(' same')).toBe('structured-diff-context');
    expect(diffLineClass('')).toBe('structured-diff-context');
  });
});

describe('DiffPatch', () => {
  it('renders each patch line with its class', () => {
    const { container } = render(<DiffPatch patch={'@@ -1 +1 @@\n-old\n+new\n same'} />);
    const pre = container.querySelector('pre.structured-diff-patch');
    expect(pre).not.toBeNull();
    const spans = Array.from(container.querySelectorAll('code > span'));
    expect(spans.map((span) => span.className)).toEqual([
      'structured-diff-hunk',
      'structured-diff-deletion',
      'structured-diff-addition',
      'structured-diff-context'
    ]);
    expect(spans[1]?.textContent).toBe('-old\n');
  });

  it('renders repeated identical lines', () => {
    const { container } = render(<DiffPatch patch={'+same\n+same\n+same'} />);
    expect(container.querySelectorAll('code > span')).toHaveLength(3);
  });

  it('accepts a custom class name', () => {
    const { container } = render(<DiffPatch patch="+x" className="changes-patch" />);
    expect(container.querySelector('pre.changes-patch')).not.toBeNull();
  });
});
