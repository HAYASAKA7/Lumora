import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const rendererRoot = resolve(process.cwd(), 'src/renderer/src');
const stylesheet = readFileSync(
  resolve(rendererRoot, 'styles.css'),
  'utf8'
);
const styledClasses = new Set(
  [...stylesheet.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1])
);

function rendererTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return rendererTsxFiles(path);
    }
    return extname(entry.name) === '.tsx' ? [path] : [];
  });
}

/**
 * A class group is one set of classes the renderer can apply on its own: a
 * plain string, one branch of a conditional, or the static part of a template.
 */
function classGroups(node: ts.Node): string[] {
  if (ts.isStringLiteralLike(node)) {
    return [node.text];
  }
  if (ts.isJsxExpression(node) || ts.isParenthesizedExpression(node)) {
    return node.expression === undefined ? [] : classGroups(node.expression);
  }
  if (ts.isConditionalExpression(node)) {
    return [...classGroups(node.whenTrue), ...classGroups(node.whenFalse)];
  }
  if (ts.isTemplateExpression(node)) {
    return [
      node.head.text,
      ...node.templateSpans.map((span) => span.literal.text)
    ];
  }
  return [];
}

/**
 * A class carries the Lumora look either directly or by extending a base class
 * applied alongside it, the way `structured-composer-action-send` refines
 * `structured-composer-action`. A class that does neither leaves the button
 * with browser-default chrome.
 */
function unstyledClasses(group: string): string[] {
  const classes = group.split(/\s+/).filter((value) => value.length > 0);
  return classes.filter(
    (candidate) =>
      !styledClasses.has(candidate) &&
      !classes.some(
        (base) =>
          base !== candidate &&
          styledClasses.has(base) &&
          candidate.startsWith(`${base}-`)
      )
  );
}

describe('renderer button style contract', () => {
  it('styles every button class through the stylesheet', () => {
    const violations = rendererTsxFiles(rendererRoot).flatMap((path) => {
      const sourceFile = ts.createSourceFile(
        path,
        readFileSync(path, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
      );
      const matches: string[] = [];
      function visit(node: ts.Node): void {
        if (
          ts.isJsxAttribute(node) &&
          ts.isIdentifier(node.name) &&
          node.name.text === 'className' &&
          node.initializer !== undefined &&
          ts.isJsxOpeningLikeElement(node.parent.parent) &&
          node.parent.parent.tagName.getText(sourceFile) === 'button'
        ) {
          const line =
            sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          for (const group of classGroups(node.initializer)) {
            for (const unstyled of unstyledClasses(group)) {
              matches.push(`${relative(rendererRoot, path)}:${line} ${unstyled}`);
            }
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(sourceFile);
      return matches;
    });

    expect(violations).toEqual([]);
  });
});
