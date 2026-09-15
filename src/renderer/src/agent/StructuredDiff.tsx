import type { StructuredAgentDiffView } from './structured-agent-state';
import { DiffPatch } from '../changes/DiffPatch';
import { OverflowTooltip } from '../ui/Tooltip';

interface StructuredDiffProps {
  diff: StructuredAgentDiffView;
  label: string;
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
      <DiffPatch patch={file.patch} />
    </details>
  ));
}
