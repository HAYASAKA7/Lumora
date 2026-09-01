import type { StructuredAgentDiffView } from './structured-agent-state';
import { OverflowTooltip } from '../ui/Tooltip';

interface StructuredDiffProps {
  diff: StructuredAgentDiffView;
  label: string;
}

function lineClass(line: string): string {
  if (line.startsWith('@@')) return 'structured-diff-hunk';
  if (
    line.startsWith('diff --git ') || line.startsWith('index ') ||
    line.startsWith('---') || line.startsWith('+++') ||
    line.startsWith('new file mode ') || line.startsWith('deleted file mode ') ||
    line.startsWith('rename from ') || line.startsWith('rename to ')
  ) return 'structured-diff-metadata';
  if (line.startsWith('+')) return 'structured-diff-addition';
  if (line.startsWith('-')) return 'structured-diff-deletion';
  return 'structured-diff-context';
}

export function StructuredDiff({ diff, label }: StructuredDiffProps) {
  return diff.files.map((file, index) => (
    <details className="structured-diff" key={`${diff.id}:${file.pathLabel}:${index}`}>
      <summary>
        <span className="structured-diff-heading">
          <span className="card-label">{label}</span>
          <OverflowTooltip content={file.pathLabel}>
            <code>{file.pathLabel}</code>
          </OverflowTooltip>
        </span>
        <span className="structured-diff-stats" aria-label={`+${file.additions} -${file.deletions}`}>
          <span className="structured-diff-additions">+{file.additions}</span>
          <span className="structured-diff-deletions">-{file.deletions}</span>
        </span>
      </summary>
      {file.oldPathLabel === null ? null : (
        <p className="structured-diff-rename">
          <code>{file.oldPathLabel}</code>
          <span aria-hidden="true"> → </span>
          <code>{file.pathLabel}</code>
        </p>
      )}
      <pre className="structured-diff-patch">
        <code>
          {file.patch.split('\n').map((line, lineNumber) => (
            <span className={lineClass(line)} key={`${lineNumber}:${line}`}>
              {line || ' '}{'\n'}
            </span>
          ))}
        </code>
      </pre>
    </details>
  ));
}
