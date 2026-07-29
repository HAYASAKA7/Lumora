import { describe, expect, it } from 'vitest';

import {
  applyRootMapping,
  groupArchiveWorkspaces,
  proposeWorkspaceMappings,
  validateExplicitWorkspaceMapping,
  type WorkspacePathProbes,
  type WorkspaceTransferGroup
} from './workspace-mapper';

function probes(...directories: string[]): WorkspacePathProbes {
  const existing = new Set(directories);
  return {
    isDirectory: async (path) => existing.has(path)
  };
}

function group(
  overrides: Partial<WorkspaceTransferGroup> = {}
): WorkspaceTransferGroup {
  return {
    sourceWorkspaceKey: 'workspace:lumora',
    originalPath: '/work/Lumora',
    displayName: 'Lumora',
    gitRemote: null,
    markers: ['.git', 'package.json'],
    sessionIds: ['a'.repeat(64)],
    ...overrides
  };
}

describe('workspace mapper', () => {
  it('groups archive sessions deterministically without losing workspace evidence', () => {
    expect(
      groupArchiveWorkspaces([
        {
          sessionId: 'b'.repeat(64),
          sourceWorkspaceKey: 'workspace:lumora',
          workspacePath: '/work/Lumora',
          workspaceName: 'Lumora',
          gitRemote: 'git@github.com:HAYASAKA7/Lumora.git',
          markers: ['package.json', '.git']
        },
        {
          sessionId: 'a'.repeat(64),
          sourceWorkspaceKey: 'workspace:lumora',
          workspacePath: '/work/Lumora',
          workspaceName: 'Lumora',
          gitRemote: 'git@github.com:HAYASAKA7/Lumora.git',
          markers: ['.git']
        }
      ])
    ).toEqual([
      {
        sourceWorkspaceKey: 'workspace:lumora',
        originalPath: '/work/Lumora',
        displayName: 'Lumora',
        gitRemote: 'git@github.com:HAYASAKA7/Lumora.git',
        markers: ['.git', 'package.json'],
        sessionIds: ['a'.repeat(64), 'b'.repeat(64)]
      }
    ]);
  });

  it('applies one Windows-to-macOS root mapping to every child workspace', async () => {
    const expected = [
      '/Users/haya/Developer/Lumora',
      '/Users/haya/Developer/Other'
    ];
    await expect(
      applyRootMapping({
        sourceRoot: 'D:\\Projects\\AI',
        destinationRoot: '/Users/haya/Developer',
        sourcePlatform: 'win32',
        destinationPlatform: 'darwin',
        workspacePaths: [
          'D:\\Projects\\AI\\Lumora',
          'D:\\Projects\\AI\\Other'
        ],
        probes: probes(...expected)
      })
    ).resolves.toEqual(expected);
  });

  it('requires root mappings to match a complete source path segment', async () => {
    await expect(
      applyRootMapping({
        sourceRoot: 'D:\\Projects\\AI',
        destinationRoot: '/Users/haya/Developer',
        sourcePlatform: 'win32',
        destinationPlatform: 'darwin',
        workspacePaths: ['D:\\Projects\\AI-Lab\\Lumora'],
        probes: probes('/Users/haya/Developer/Lumora')
      })
    ).rejects.toThrow(/outside/i);
  });

  it('refuses mapped and explicitly selected destinations that are not directories', async () => {
    await expect(
      applyRootMapping({
        sourceRoot: '/work',
        destinationRoot: '/destination',
        sourcePlatform: 'linux',
        destinationPlatform: 'linux',
        workspacePaths: ['/work/Lumora'],
        probes: probes()
      })
    ).rejects.toThrow(/directory/i);

    await expect(
      validateExplicitWorkspaceMapping({
        sourceWorkspaceKey: 'workspace:lumora',
        destinationWorkspaceId: 'c'.repeat(64),
        destinationPath: '/destination/Lumora',
        destinationPlatform: 'linux',
        probes: probes()
      })
    ).rejects.toThrow(/directory/i);
  });

  it('auto-maps one exact canonical path with highest confidence', async () => {
    const [proposal] = await proposeWorkspaceMappings({
      sourcePlatform: 'linux',
      destinationPlatform: 'linux',
      groups: [group()],
      candidates: [
        {
          workspaceId: 'c'.repeat(64),
          canonicalPath: '/work/Lumora',
          displayName: 'Lumora',
          gitRemote: null,
          markers: ['.git', 'package.json']
        }
      ],
      probes: probes('/work/Lumora')
    });

    expect(proposal).toMatchObject({
      state: 'mapped',
      reason: 'exact_canonical_path',
      confidence: 100,
      destinationWorkspaceId: 'c'.repeat(64)
    });
  });

  it('normalizes equivalent Git remote forms for a unique automatic match', async () => {
    const [proposal] = await proposeWorkspaceMappings({
      sourcePlatform: 'win32',
      destinationPlatform: 'darwin',
      groups: [
        group({
          originalPath: 'D:\\Projects\\Lumora',
          gitRemote: 'git@github.com:HAYASAKA7/Lumora.git'
        })
      ],
      candidates: [
        {
          workspaceId: 'd'.repeat(64),
          canonicalPath: '/Users/haya/Developer/Lumora',
          displayName: 'Lumora checkout',
          gitRemote: 'https://github.com/HAYASAKA7/Lumora',
          markers: ['.git']
        }
      ],
      probes: probes('/Users/haya/Developer/Lumora')
    });

    expect(proposal).toMatchObject({
      state: 'mapped',
      reason: 'unique_git_remote',
      confidence: 90,
      destinationWorkspaceId: 'd'.repeat(64)
    });
  });

  it('auto-maps a unique name-and-marker match but keeps name-only as a suggestion', async () => {
    const candidates = [
      {
        workspaceId: 'e'.repeat(64),
        canonicalPath: '/code/Lumora',
        displayName: 'Lumora',
        gitRemote: null,
        markers: ['.git', 'package.json']
      },
      {
        workspaceId: 'f'.repeat(64),
        canonicalPath: '/code/Other',
        displayName: 'Other',
        gitRemote: null,
        markers: []
      }
    ];
    const results = await proposeWorkspaceMappings({
      sourcePlatform: 'linux',
      destinationPlatform: 'linux',
      groups: [
        group(),
        group({
          sourceWorkspaceKey: 'workspace:other',
          originalPath: '/old/Other',
          displayName: 'Other',
          markers: []
        })
      ],
      candidates,
      probes: probes('/code/Lumora', '/code/Other')
    });

    expect(results[0]).toMatchObject({
      state: 'mapped',
      reason: 'unique_name_and_markers',
      confidence: 70
    });
    expect(results[1]).toMatchObject({
      state: 'suggested',
      reason: 'name_only',
      confidence: 40
    });
  });

  it('never auto-selects two workspaces with the same confidence', async () => {
    const [proposal] = await proposeWorkspaceMappings({
      sourcePlatform: 'linux',
      destinationPlatform: 'linux',
      groups: [group({ originalPath: '/old/Lumora' })],
      candidates: [
        {
          workspaceId: '1'.repeat(64),
          canonicalPath: '/code/a/Lumora',
          displayName: 'Lumora',
          gitRemote: null,
          markers: ['.git', 'package.json']
        },
        {
          workspaceId: '2'.repeat(64),
          canonicalPath: '/code/b/Lumora',
          displayName: 'Lumora',
          gitRemote: null,
          markers: ['.git', 'package.json']
        }
      ],
      probes: probes('/code/a/Lumora', '/code/b/Lumora')
    });

    expect(proposal).toMatchObject({
      state: 'unresolved',
      reason: 'ambiguous',
      confidence: 70
    });
  });

  it('returns a frozen validated explicit mapping', async () => {
    const result = await validateExplicitWorkspaceMapping({
      sourceWorkspaceKey: 'workspace:lumora',
      destinationWorkspaceId: 'c'.repeat(64),
      destinationPath: '/destination/Lumora',
      destinationPlatform: 'linux',
      probes: probes('/destination/Lumora')
    });

    expect(result).toEqual({
      sourceWorkspaceKey: 'workspace:lumora',
      destinationWorkspaceId: 'c'.repeat(64),
      destinationPath: '/destination/Lumora'
    });
    expect(Object.isFrozen(result)).toBe(true);
  });
});
