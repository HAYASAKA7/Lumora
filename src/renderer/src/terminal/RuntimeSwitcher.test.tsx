import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { RuntimeSummary } from '../../../shared/contracts';
import {
  RuntimeSwitcher,
  buildRuntimeMru,
  nextRuntimeInOrder,
  touchRuntimeMru
} from './RuntimeSwitcher';

const first: RuntimeSummary = {
  id: '0198f8b6-18f3-7ca0-9f0f-123456789abc',
  displayName: 'Repository cleanup',
  strategy: 'new',
  sessionId: null,
  nativeSessionId: null,
  reconciliationState: 'pending',
  provider: 'codex',
  workspaceId: 'a'.repeat(64),
  terminalProfileId: 'b'.repeat(64),
  launchHash: 'c'.repeat(64),
  state: 'running',
  pid: 101,
  createdAt: '2026-07-14T01:00:00.000Z',
  startedAt: '2026-07-14T01:00:01.000Z',
  endedAt: null,
  exitCode: null,
  errorCode: null
};
const second: RuntimeSummary = {
  ...first,
  id: '0198f8b6-18f3-7ca0-9f0f-123456789abd',
  displayName: 'Release notes',
  provider: 'claude',
  pid: 102
};

describe('runtime switcher', () => {
  it('maintains a unique MRU order and appends newly opened runtimes', () => {
    expect(touchRuntimeMru(['first', 'second', 'third'], 'second')).toEqual([
      'second',
      'first',
      'third'
    ]);
    expect(buildRuntimeMru(
      ['first', 'second', 'fourth'],
      ['second', 'missing', 'first'],
      'first'
    )).toEqual(['first', 'second', 'fourth']);
  });

  it('cycles around the MRU order', () => {
    expect(nextRuntimeInOrder(['first', 'second', 'third'], 'first')).toBe(
      'second'
    );
    expect(nextRuntimeInOrder(['first', 'second', 'third'], 'third')).toBe(
      'first'
    );
    expect(nextRuntimeInOrder(['first'], 'first')).toBe('first');
  });

  it('renders all open terminals and marks the pending selection', () => {
    render(
      <RuntimeSwitcher
        runtimes={[first, second]}
        selectedRuntimeId={second.id}
      />
    );

    const dialog = screen.getByRole('dialog', { name: 'Open terminals' });
    const options = within(dialog).getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent('Repository cleanup');
    expect(options[0]).toHaveTextContent('Codex');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    expect(options[1]).toHaveTextContent('Release notes');
  });
});
