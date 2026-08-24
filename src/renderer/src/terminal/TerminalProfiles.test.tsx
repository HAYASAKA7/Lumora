import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TerminalProfiles } from './TerminalProfiles';
import { renderWithLocalization } from '../test/render-with-localization';

const render = renderWithLocalization;

const detected = {
  id: 'a'.repeat(64),
  kind: 'detected' as const,
  name: 'PowerShell 7',
  shellFamily: 'pwsh' as const,
  executablePath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
  args: [],
  available: true,
  recommended: true
};

describe('TerminalProfiles', () => {
  it('shows detections and saves bounded argument arrays', async () => {
    const custom = {
      ...detected,
      id: 'b'.repeat(64),
      kind: 'custom' as const,
      name: 'Project shell',
      recommended: false
    };
    const saveTerminalProfile = vi.fn().mockResolvedValue([detected, custom]);
    Object.defineProperty(window, 'lumora', {
      configurable: true,
      value: {
        getTerminalProfiles: vi.fn().mockResolvedValue([detected]),
        saveTerminalProfile,
        deleteTerminalProfile: vi.fn()
      }
    });
    const onProfilesChange = vi.fn();
    render(<TerminalProfiles onProfilesChange={onProfilesChange} />);

    expect(await screen.findByText('PowerShell 7')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Project shell' }
    });
    fireEvent.change(screen.getByLabelText('Absolute executable path'), {
      target: { value: 'C:\\tools\\pwsh.exe' }
    });
    fireEvent.change(screen.getByLabelText('Base arguments (one per line)'), {
      target: { value: '-NoLogo\n-NoProfile' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() =>
      expect(saveTerminalProfile).toHaveBeenCalledWith({
        name: 'Project shell',
        shellFamily: 'other',
        executablePath: 'C:\\tools\\pwsh.exe',
        args: ['-NoLogo', '-NoProfile']
      })
    );
    expect(await screen.findByText('Project shell')).toBeInTheDocument();
    expect(onProfilesChange).toHaveBeenLastCalledWith([detected, custom]);
  });
});
