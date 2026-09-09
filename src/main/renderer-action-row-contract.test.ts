import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const rendererRoot = resolve(process.cwd(), 'src/renderer/src');

/** Containers that lay buttons out in one row. */
const ACTION_ROW_CLASSES = [
  'catalog-actions',
  'catalog-toolbar',
  'diagnostics-panel-actions',
  'provider-card-actions',
  'provider-panel-actions',
  'remote-target-actions'
];

type Slot = 'icon' | 'word' | 'mixed';

function rendererTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return rendererTsxFiles(path);
    return extname(entry.name) === '.tsx' ? [path] : [];
  });
}

function tagName(node: ts.Node): string | null {
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText();
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText();
  return null;
}

/**
 * A branch that renders nothing tells us nothing about the slot, so it is
 * skipped. A branch rendering both kinds could be either at run time, which is
 * exactly when a static reading must not claim to know.
 */
function slotOf(node: ts.Node): Slot | null {
  const name = tagName(node);
  if (name === 'IconButton') return 'icon';
  if (name === 'button') return 'word';

  // TypeScript calls a `{...}` child a JsxExpression; JsxExpressionContainer
  // is Babel's name for it and does not exist here.
  if (node.kind === ts.SyntaxKind.JsxExpression) {
    const container = node as ts.JsxExpression;
    if (container.expression === undefined) return null;
    const kinds = new Set<Slot>();
    const visit = (inner: ts.Node): void => {
      const kind = tagName(inner) === 'IconButton'
        ? 'icon'
        : tagName(inner) === 'button' ? 'word' : null;
      if (kind !== null) kinds.add(kind);
      else ts.forEachChild(inner, visit);
    };
    visit(container.expression);
    if (kinds.size === 1) return [...kinds][0]!;
    if (kinds.size > 1) return 'mixed';
  }
  return null;
}

function rowClass(node: ts.JsxElement): string | null {
  for (const attribute of node.openingElement.attributes.properties) {
    if (
      !ts.isJsxAttribute(attribute) ||
      attribute.name.getText() !== 'className' ||
      attribute.initializer === undefined ||
      !ts.isStringLiteral(attribute.initializer)
    ) continue;
    const classes = attribute.initializer.text.split(/\s+/);
    return ACTION_ROW_CLASSES.find((name) => classes.includes(name)) ?? null;
  }
  return null;
}

describe('renderer action row contract', () => {
  /**
   * A row holds its worded buttons together and its icon buttons together. An
   * icon dropped between two words reads as punctuation between two labels
   * rather than as a control of its own.
   */
  it('never puts an icon button between two worded buttons', () => {
    const violations: string[] = [];

    for (const path of rendererTsxFiles(rendererRoot)) {
      const sourceFile = ts.createSourceFile(
        path,
        readFileSync(path, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
      );

      const visit = (node: ts.Node): void => {
        if (ts.isJsxElement(node) && rowClass(node) !== null) {
          const slots = node.children
            .map(slotOf)
            .filter((slot): slot is Slot => slot !== null);
          for (let index = 1; index < slots.length - 1; index += 1) {
            if (
              slots[index] === 'icon' &&
              slots[index - 1] === 'word' &&
              slots[index + 1] === 'word'
            ) {
              const line =
                sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
              violations.push(
                `${relative(rendererRoot, path).replaceAll('\\', '/')}:${line}`
              );
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }

    expect(violations).toEqual([]);
  });
});
