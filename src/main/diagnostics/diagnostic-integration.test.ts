import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');

describe('diagnostic application integration', () => {
  it('starts diagnostics before runtime composition and exposes local-only IPC', () => {
    const startJournal = source.indexOf('await diagnosticJournal.startRun()');
    const createCatalog = source.indexOf('createCatalogRuntime({');

    expect(startJournal).toBeGreaterThan(-1);
    expect(createCatalog).toBeGreaterThan(startJournal);
    expect(source).toContain('registerDiagnosticIpc({');
    expect(source).toContain('authorize: authorizeLocalIpc');
    expect(source).toContain('installDiagnosticProcessObservers({');
    expect(source).toContain("operation: 'environment-scan'");
    expect(source).toContain("operation: 'provider-scan'");
    expect(source).toContain("operation: 'catalog-refresh'");
  });

  it('marks the run clean only after orderly runtime shutdown', () => {
    const shutdown = source.slice(source.indexOf("app.on('before-quit'"));
    const shutdownRuntime = shutdown.indexOf('runtime?.shutdown()');
    const finishRun = shutdown.indexOf('await diagnosticJournal?.finishRun()');

    expect(shutdownRuntime).toBeGreaterThan(-1);
    expect(finishRun).toBeGreaterThan(shutdownRuntime);
    expect(source).not.toContain("process.on('uncaughtException'");
  });
});
