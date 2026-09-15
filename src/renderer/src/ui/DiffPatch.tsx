import { memo, useMemo } from 'react';

export function diffLineClass(line: string): string {
  if (line.startsWith('@@')) return 'structured-diff-hunk';
  if (
    line.startsWith('diff --git ') || line.startsWith('index ') ||
    line.startsWith('---') || line.startsWith('+++') ||
    line.startsWith('new file mode ') || line.startsWith('deleted file mode ') ||
    line.startsWith('rename from ') || line.startsWith('rename to ') ||
    line.startsWith('similarity index ')
  ) return 'structured-diff-metadata';
  if (line.startsWith('+')) return 'structured-diff-addition';
  if (line.startsWith('-')) return 'structured-diff-deletion';
  return 'structured-diff-context';
}

interface DiffPatchProps {
  patch: string;
  className?: string;
}

function DiffPatchView({ patch, className = 'structured-diff-patch' }: DiffPatchProps) {
  const lines = useMemo(() => patch.split('\n'), [patch]);
  return (
    <pre className={className}>
      <code>
        {lines.map((line, lineNumber) => (
          // A patch is rendered whole and never reordered; the line number is a stable key.
          <span className={diffLineClass(line)} key={lineNumber}>
            {line || ' '}{'\n'}
          </span>
        ))}
      </code>
    </pre>
  );
}

export const DiffPatch = memo(DiffPatchView);
