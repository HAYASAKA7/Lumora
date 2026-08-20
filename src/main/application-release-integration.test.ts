import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('application release lifecycle integration', () => {
  it('warms without blocking startup and closes the owned runtime', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(source).toContain('registerAboutIpc({');
    expect(source).toContain('authorize: authorizeTargetIpc');
    expect(source).toContain('void applicationReleaseRuntime.service.warm().catch(() => undefined)');
    expect(source).toContain('await releaseRuntime?.close()');
  });
});
