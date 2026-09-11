import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const rendererRoot = resolve(process.cwd(), 'src/renderer/src');

/** Marks for an action that takes time: re-reading, raising, fetching. */
const WORKING_MARKS = new Set(['RefreshIcon', 'UpdateIcon', 'DownloadIcon']);

function rendererTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return rendererTsxFiles(path);
    return extname(entry.name) === '.tsx' && !entry.name.includes('.test.')
      ? [path]
      : [];
  });
}

function drawsWorkingMark(element: ts.JsxElement): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isJsxSelfClosingElement(node) &&
      WORKING_MARKS.has(node.tagName.getText())
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  element.children.forEach(visit);
  return found;
}

function declares(element: ts.JsxElement, name: string): boolean {
  return element.openingElement.attributes.properties.some(
    (attribute) =>
      ts.isJsxAttribute(attribute) && attribute.name.getText() === name
  );
}

function declaresBusy(element: ts.JsxElement): boolean {
  return element.openingElement.attributes.properties.some(
    (attribute) =>
      ts.isJsxAttribute(attribute) && attribute.name.getText() === 'busy'
  );
}

describe('renderer busy contract', () => {
  /**
   * A button whose action takes time has to say so while it runs. Without
   * `busy` it looks idle the whole time, and a second press starts the work
   * again.
   */
  it('gives every refresh, update and install mark a busy state', () => {
    const missing: string[] = [];

    for (const path of rendererTsxFiles(rendererRoot)) {
      const sourceFile = ts.createSourceFile(
        path,
        readFileSync(path, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
      );
      const visit = (node: ts.Node): void => {
        if (
          ts.isJsxElement(node) &&
          node.openingElement.tagName.getText() === 'IconButton' &&
          drawsWorkingMark(node) &&
          !declaresBusy(node)
        ) {
          const line =
            sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          missing.push(
            `${relative(rendererRoot, path).replaceAll('\\', '/')}:${line}`
          );
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }

    expect(missing).toEqual([]);
  });

  /**
   * While a button works its tooltip should say what it is doing: the name of
   * the action it will start is the wrong thing to show once it has started.
   */
  it('gives every busy button a description of the work', () => {
    const missing: string[] = [];

    for (const path of rendererTsxFiles(rendererRoot)) {
      const sourceFile = ts.createSourceFile(
        path,
        readFileSync(path, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
      );
      const visit = (node: ts.Node): void => {
        if (
          ts.isJsxElement(node) &&
          node.openingElement.tagName.getText() === 'IconButton' &&
          declaresBusy(node) &&
          !declares(node, 'busyLabel')
        ) {
          const line =
            sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          const file = relative(rendererRoot, path)
            .split(String.fromCharCode(92)).join('/');
          missing.push(`${file}:${line}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }

    expect(missing).toEqual([]);
  });
});
