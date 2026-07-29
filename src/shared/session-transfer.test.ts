import crypto from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  SessionExportExecuteRequestSchema,
  SessionExportPrepareRequestSchema,
  SessionImportPlanRequestSchema,
  SessionTransferProgressEventSchema,
  TransferHistoryEntrySchema
} from './session-transfer';

describe('session transfer contracts', () => {
  it('accepts mixed-provider export selections without duplicate session IDs', () => {
    expect(
      SessionExportPrepareRequestSchema.parse({
        sessionIds: ['a'.repeat(64), 'b'.repeat(64)]
      })
    ).toEqual({ sessionIds: ['a'.repeat(64), 'b'.repeat(64)] });
    expect(() =>
      SessionExportPrepareRequestSchema.parse({
        sessionIds: ['a'.repeat(64), 'a'.repeat(64)]
      })
    ).toThrow();
  });

  it('does not expose archive paths or passwords in transfer history', () => {
    expect(() =>
      TransferHistoryEntrySchema.parse({
        id: crypto.randomUUID(),
        direction: 'export',
        completedAt: new Date().toISOString(),
        importedCount: 0,
        exportedCount: 1,
        skippedCount: 0,
        providers: ['opencode'],
        archivePath: 'D:\\secret.lumora-sessions'
      })
    ).toThrow();
  });

  it('requires a password only for encrypted execution', () => {
    expect(
      SessionExportExecuteRequestSchema.safeParse({
        planToken: crypto.randomUUID(),
        protection: { encrypted: false }
      }).success
    ).toBe(true);
    expect(
      SessionExportExecuteRequestSchema.safeParse({
        planToken: crypto.randomUUID(),
        protection: { encrypted: true, password: '' }
      }).success
    ).toBe(false);
  });

  it('accepts mixed-provider import plans and rejects duplicate providers', () => {
    const inspectionToken = crypto.randomUUID();
    const base = {
      inspectionToken,
      providers: ['opencode', 'codex'],
      workspaceMappings: [
        {
          sourceWorkspaceKey: 'workspace-a',
          action: 'map',
          destinationWorkspaceId: 'c'.repeat(64)
        },
        {
          sourceWorkspaceKey: 'workspace-b',
          action: 'skip'
        }
      ]
    };

    expect(SessionImportPlanRequestSchema.parse(base)).toEqual(base);
    expect(
      SessionImportPlanRequestSchema.safeParse({
        ...base,
        providers: ['opencode', 'opencode']
      }).success
    ).toBe(false);
  });

  it('bounds public progress messages and does not accept paths', () => {
    const event = {
      operationId: crypto.randomUUID(),
      direction: 'import',
      phase: 'writing',
      completed: 1,
      total: 2,
      message: 'Importing OpenCode session.'
    } as const;

    expect(SessionTransferProgressEventSchema.parse(event)).toEqual(event);
    expect(
      SessionTransferProgressEventSchema.safeParse({
        ...event,
        message: 'x'.repeat(513)
      }).success
    ).toBe(false);
    expect(
      SessionTransferProgressEventSchema.safeParse({
        ...event,
        archivePath: 'D:\\secret.lumora-sessions'
      }).success
    ).toBe(false);
  });
});
