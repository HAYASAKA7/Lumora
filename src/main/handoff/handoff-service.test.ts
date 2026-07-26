import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { HandoffService } from './handoff-service';

const roots: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(roots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true
  })));
});

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'lumora-handoff-'));
  roots.push(value);
  return value;
}

describe('HandoffService', () => {
  it('materializes an immutable source copy, manifest, context, and bounded prompt', async () => {
    const rootDirectory = await root();
    const service = new HandoffService({
      rootDirectory,
      clock: () => new Date('2026-07-23T08:00:00.000Z'),
      createId: () => '019c0000-0000-7000-8000-000000000001'
    });
    const plan = service.reserve({
      sourceSessionId: 'a'.repeat(64),
      sourceNativeId: 'native-codex-1',
      sourceProvider: 'codex',
      destinationProvider: 'claude',
      retentionDays: 30,
      startPrompt: 'Fix the tests.'
    });
    expect(plan.prompt).toContain(plan.contextDirectory);
    expect(plan.prompt).toContain(
      'Use the language the user uses in the imported conversation and future messages.'
    );
    expect(plan.prompt).toContain(
      'Do not prefer English because these Lumora instructions are in English.'
    );
    expect(plan.prompt).not.toContain('private prompt');
    expect(plan.prompt).toContain('User start task: Fix the tests.');
    expect(plan.prompt).not.toContain('then wait for the user');
    expect(plan.prompt.length).toBeLessThan(4_096);

    const result = await service.materialize(plan, async (sourceDirectory) => {
      const sourcePath = join(sourceDirectory, 'session.jsonl');
      const raw = [
        {
          timestamp: '2026-07-23T07:00:00.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'private prompt' }]
          }
        },
        {
          timestamp: '2026-07-23T07:01:00.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'private answer' }]
          }
        }
      ].map((value) => JSON.stringify(value)).join('\n');
      await writeFile(sourcePath, raw, { encoding: 'utf8', flag: 'wx' });
      return { raw, sourceFiles: [sourcePath] };
    });

    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8'));
    expect(manifest).toMatchObject({
      id: plan.id,
      sourceProvider: 'codex',
      destinationProvider: 'claude',
      messageCoverage: 'complete',
      messageCount: 2
    });
    expect(manifest.sourceFiles).toEqual(['source/session.jsonl']);
    const context = await readFile(result.contextFiles[0]!, 'utf8');
    expect(context).toContain('## 1. User');
    expect(context).toContain('private prompt');
    expect(context).toContain('## 2. Assistant');
    expect(context).toContain('private answer');
    expect(JSON.stringify(manifest)).not.toContain('Fix the tests.');
    expect(context).not.toContain('Fix the tests.');
    expect(await readFile(join(plan.sourceDirectory, 'session.jsonl'), 'utf8'))
      .not.toContain('Fix the tests.');
  });

  it('deletes an incomplete handoff when normalization fails', async () => {
    const rootDirectory = await root();
    const service = new HandoffService({
      rootDirectory,
      createId: () => '019c0000-0000-7000-8000-000000000002'
    });
    const plan = service.reserve({
      sourceSessionId: 'b'.repeat(64),
      sourceNativeId: 'native-2',
      sourceProvider: 'codex',
      destinationProvider: 'qwen',
      retentionDays: 7,
      startPrompt: ''
    });

    await expect(service.materialize(plan, async (sourceDirectory) => {
      const sourcePath = join(sourceDirectory, 'session.jsonl');
      const raw = JSON.stringify({ type: 'reasoning', content: 'private' });
      await writeFile(sourcePath, raw, 'utf8');
      return { raw, sourceFiles: [sourcePath] };
    })).rejects.toThrow('does not contain a readable conversation');

    const { access } = await import('node:fs/promises');
    await expect(access(plan.directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('cleans expired managed copies while preserving current copies', async () => {
    const rootDirectory = await root();
    const oldDirectory = join(rootDirectory, 'old');
    const currentDirectory = join(rootDirectory, 'current');
    await mkdir(oldDirectory, { recursive: true });
    await mkdir(currentDirectory, { recursive: true });
    await writeFile(join(oldDirectory, 'manifest.json'), JSON.stringify({
      createdAt: '2026-06-01T00:00:00.000Z'
    }));
    await writeFile(join(currentDirectory, 'manifest.json'), JSON.stringify({
      createdAt: '2026-07-20T00:00:00.000Z'
    }));
    const service = new HandoffService({
      rootDirectory,
      clock: () => new Date('2026-07-23T00:00:00.000Z')
    });

    await expect(service.cleanupExpired(7)).resolves.toEqual({ removed: 1 });
    const { access } = await import('node:fs/promises');
    await expect(access(oldDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(currentDirectory)).resolves.toBeUndefined();
  });
});
