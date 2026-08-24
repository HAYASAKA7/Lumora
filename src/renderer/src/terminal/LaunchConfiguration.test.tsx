import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { LaunchPreview } from '../../../shared/contracts';
import { LaunchConfiguration } from './LaunchConfiguration';
import { renderWithLocalization } from '../test/render-with-localization';

const render = renderWithLocalization;

const profileId = 'a'.repeat(64);
const preview = {
  command: 'workspace-codex',
  terminalProfile: {
    id: profileId,
    kind: 'detected',
    name: 'PowerShell 7',
    shellFamily: 'pwsh',
    executablePath: 'C:\\tools\\pwsh.exe',
    args: [],
    available: true,
    recommended: true
  },
  configuration: [
    {
      field: 'providerCommand',
      value: 'workspace-codex',
      winningSource: { scope: 'workspace', targetId: 'b'.repeat(64) },
      shadowed: [
        {
          value: null,
          source: { scope: 'default', targetId: null }
        },
        {
          value: 'provider-codex',
          source: { scope: 'provider', targetId: 'codex' }
        }
      ],
      mergeStrategy: 'replace',
      warnings: [],
      sensitive: false
    },
    {
      field: 'terminalProfile',
      value: profileId,
      winningSource: { scope: 'session', targetId: 'c'.repeat(64) },
      shadowed: [],
      mergeStrategy: 'replace',
      warnings: [
        'The workspace terminal profile is unavailable; using the lower-precedence value.'
      ],
      sensitive: false
    }
  ]
} as Pick<LaunchPreview, 'command' | 'terminalProfile' | 'configuration'>;

describe('LaunchConfiguration', () => {
  it('shows winning sources and discloses shadowed values and warnings', () => {
    render(<LaunchConfiguration preview={preview} />);

    expect(
      screen.getByRole('heading', { name: 'Effective launch settings' })
    ).toBeInTheDocument();
    expect(screen.getByText('Workspace layer')).toBeInTheDocument();
    expect(screen.getByText('Session layer')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Why these values?'));
    expect(screen.getByText(/Provider layer: provider-codex/)).toBeInTheDocument();
    expect(
      screen.getByText(/workspace terminal profile is unavailable/)
    ).toBeInTheDocument();
  });
});
