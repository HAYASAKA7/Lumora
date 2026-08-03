import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const rendererRoot = resolve(process.cwd(), 'src/renderer/src');

function rendererTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return rendererTsxFiles(path);
    }
    return extname(entry.name) === '.tsx' ? [path] : [];
  });
}

describe('renderer tooltip contract', () => {
  it('does not use native browser title tooltips', () => {
    const violations = rendererTsxFiles(rendererRoot).flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      const sourceFile = ts.createSourceFile(
        path,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
      );
      const matches: string[] = [];
      function visit(node: ts.Node): void {
        if (
          ts.isJsxAttribute(node) &&
          ts.isIdentifier(node.name) &&
          node.name.text === 'title'
        ) {
          const line =
            sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          matches.push(`${relative(rendererRoot, path)}:${line}`);
        }
        ts.forEachChild(node, visit);
      }
      visit(sourceFile);
      return matches;
    });

    expect(violations).toEqual([]);
  });
});
