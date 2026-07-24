import type { ReactNode } from 'react';

import type { WorkspaceSummary } from '../../../shared/contracts';

interface WorkspaceTrustNoticeProps {
  workspace: WorkspaceSummary;
  confirmed: boolean;
  onConfirmedChange(confirmed: boolean): void;
}

export function WorkspaceTrustNotice({
  workspace,
  confirmed,
  onConfirmedChange
}: WorkspaceTrustNoticeProps): ReactNode {
  return (
    <section
      aria-label="Workspace trust required"
      className="workspace-trust-notice"
    >
      <div className="workspace-trust-heading">
        <div>
          <p className="card-label">Workspace trust required</p>
          <h3>{workspace.displayName}</h3>
        </div>
        <code>{workspace.canonicalPath}</code>
      </div>
      <label className="workspace-trust-confirmation">
        <input
          checked={confirmed}
          onChange={(event) => onConfirmedChange(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>I trust this workspace and want to run the provider here</span>
      </label>
      <p>
        The provider can read, change, and run files here using your
        operating-system permissions.
      </p>
      <p>
        Lumora records this approval, but it is not an OS sandbox and does not
        restrict the provider beyond your account permissions.
      </p>
    </section>
  );
}
