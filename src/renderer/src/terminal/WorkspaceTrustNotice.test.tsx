import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { WorkspaceSummary } from '../../../shared/contracts';
import { WorkspaceTrustNotice } from './WorkspaceTrustNotice';
import {
  renderWithLocalization,
  TEST_LOCALIZATION_SNAPSHOT
} from '../test/render-with-localization';

const render = renderWithLocalization;

const workspace: WorkspaceSummary = {
  id: 'a'.repeat(64),
  displayName: 'Lumora',
  canonicalPath: 'D:\\Projects\\Lumora',
  available: true,
  origin: 'manual',
  sessionCount: 0,
  providerCounts: { codex: 0, claude: 0 },
  lastActivityAt: null
};

describe('WorkspaceTrustNotice', () => {
  it('renders Lumora trust guidance from the active locale without translating workspace data', () => {
    renderWithLocalization(
      <WorkspaceTrustNotice
        confirmed={false}
        onConfirmedChange={vi.fn()}
        workspace={workspace}
      />,
      {
        ...TEST_LOCALIZATION_SNAPSHOT,
        locale: 'zh-Hans',
        formattingLocale: 'zh-CN',
        messages: {
          ...TEST_LOCALIZATION_SNAPSHOT.messages,
          'terminal.trust.required-label': '需要信任工作区',
          'terminal.trust.confirmation': '我信任此工作区'
        }
      }
    );

    expect(screen.getByRole('region', { name: '需要信任工作区' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '我信任此工作区' })).toBeInTheDocument();
    expect(screen.getByText('Lumora')).toBeInTheDocument();
    expect(screen.getByText('D:\\Projects\\Lumora')).toBeInTheDocument();
  });

  it('explains the permission boundary and requires explicit confirmation', () => {
    const onConfirmedChange = vi.fn();
    render(
      <WorkspaceTrustNotice
        confirmed={false}
        onConfirmedChange={onConfirmedChange}
        workspace={workspace}
      />
    );

    expect(screen.getByText(workspace.displayName)).toBeInTheDocument();
    expect(screen.getByText(workspace.canonicalPath)).toBeInTheDocument();
    const permissionExplanation = screen.getByText(
      /operating-system permissions/i
    );
    expect(screen.getByText(/not an OS sandbox/i)).toBeInTheDocument();

    const checkbox = screen.getByRole('checkbox', {
      name: 'I trust this workspace and want to run the provider here'
    });
    expect(
      checkbox.compareDocumentPosition(permissionExplanation) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).not.toBe(0);
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(onConfirmedChange).toHaveBeenCalledWith(true);
  });
});
