import {
  appendFile,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DiagnosticEvent } from '../../shared/diagnostics';
import { DiagnosticJournal } from './diagnostic-journal';

function event(index: number): DiagnosticEvent {
  return {
    id: `0198f8b6-18f3-7ca0-9f0f-${String(index).padStart(12, '0')}`,
    recordedAt: new Date(Date.UTC(2026, 7, 13, 7, 0, index)).toISOString(),
    severity: index % 2 === 0 ? 'info' : 'error',
    subsystem: 'catalog',
    operation: 'catalog.refresh',
    outcome: index % 2 === 0 ? 'succeeded' : 'failed',
    correlationId: `0198f8b6-18f3-7ca0-9f0e-${String(index).padStart(12, '0')}`,
    targetKind: 'local',
    counts: { discovered: index }
  };
}

describe('DiagnosticJournal', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'lumora-diagnostics-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('serializes concurrent writes and returns recent events in order', async () => {
    const journal = new DiagnosticJournal({ directory });

    await Promise.all(Array.from({ length: 20 }, (_, index) =>
      journal.record(event(index))
    ));
    const result = await journal.readRecent(5);

    expect(result.events.map(({ counts }) => counts?.discovered)).toEqual([
      15, 16, 17, 18, 19
    ]);
    expect(result.storedEvents).toBe(20);
    expect(result.invalidRecords).toBe(0);
  });

  it('rotates bounded journal files without losing newest events', async () => {
    const journal = new DiagnosticJournal({
      directory,
      maxFileBytes: 600,
      rotatedFiles: 2
    });

    for (let index = 0; index < 12; index += 1) {
      await journal.record(event(index));
    }
    const result = await journal.readRecent(4);

    expect(result.events.map(({ counts }) => counts?.discovered)).toEqual([
      8, 9, 10, 11
    ]);
    await expect(readFile(join(directory, 'events.1.ndjson'), 'utf8'))
      .resolves.toContain('catalog.refresh');
    await expect(readFile(join(directory, 'events.2.ndjson'), 'utf8'))
      .resolves.toContain('catalog.refresh');
  });

  it('ignores malformed records and enforces the read limit', async () => {
    const journal = new DiagnosticJournal({ directory });
    await journal.record(event(1));
    await appendFile(join(directory, 'events.ndjson'), '{"message":"secret"}\n');
    await journal.record(event(2));

    const result = await journal.readRecent(1);

    expect(result.events).toEqual([event(2)]);
    expect(result.storedEvents).toBe(2);
    expect(result.invalidRecords).toBe(1);
    await expect(journal.readRecent(101)).rejects.toThrow('between 1 and 100');
  });

  it('detects an unfinished prior run and clears the marker on clean exit', async () => {
    const first = new DiagnosticJournal({
      directory,
      createId: () => '0198f8b6-18f3-7ca0-9f0f-123456789abc',
      clock: () => new Date('2026-08-13T07:00:00.000Z')
    });
    await expect(first.startRun()).resolves.toMatchObject({
      previousRunAbnormal: false
    });
    expect(JSON.parse(await readFile(join(directory, 'active-run.json'), 'utf8')))
      .toMatchObject({ runId: '0198f8b6-18f3-7ca0-9f0f-123456789abc' });

    const second = new DiagnosticJournal({
      directory,
      createId: () => '0198f8b6-18f3-7ca0-9f0f-123456789abd'
    });
    await expect(second.startRun()).resolves.toMatchObject({
      previousRunAbnormal: true
    });
    await second.finishRun();
    await expect(readFile(join(directory, 'active-run.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('treats a corrupt marker as abnormal and replaces it atomically', async () => {
    await writeFile(join(directory, 'active-run.json'), 'private corrupt data');
    const journal = new DiagnosticJournal({ directory });

    await expect(journal.startRun()).resolves.toMatchObject({
      previousRunAbnormal: true
    });
    expect(await readFile(join(directory, 'active-run.json'), 'utf8'))
      .not.toContain('private corrupt data');
  });
});
