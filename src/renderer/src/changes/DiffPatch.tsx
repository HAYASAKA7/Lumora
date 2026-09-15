import type { ReactNode } from 'react';

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

export function DiffPatch({ patch, className = 'structured-diff-patch' }: DiffPatchProps): ReactNode {
  return (
    <pre className={className}>
      <code>
        {patch.split('\n').map((line, lineNumber) => (
          <span className={diffLineClass(line)} key={`${lineNumber}:${line}`}>
            {line || ' '}{'\n'}
          </span>
        ))}
      </code>
    </pre>
  );
}
