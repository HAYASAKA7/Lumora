const { existsSync, readFileSync, readdirSync, statSync } = require('node:fs');
const { extname, join, relative, resolve } = require('node:path');
const ts = require('typescript');

const VISIBLE_ATTRIBUTES = new Set([
  'aria-label',
  'aria-description',
  'alt',
  'label',
  'placeholder',
  'title'
]);
const TEST_FILE = /(?:\.test\.|\.spec\.|[\\/]test[\\/]|[\\/]test-)/;
const TRANSLATION_CALLS = new Set(['t', 'formatDate', 'formatNumber', 'formatTime']);

function hasWords(value) {
  return /[\p{L}\p{N}]/u.test(value);
}

function isTechnical(value) {
  const text = value.trim();
  if (!hasWords(text)) return true;
  if (text === 'Lumora') return true;
  if (/^(?:common|shell|catalog|terminal|settings|providers|remote|transfer|errors)\.[a-z0-9.-]+$/.test(text)) return true;
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(text)) return true;
  if (/^(?:https?:|file:|ssh:|app:|data:)/i.test(text)) return true;
  if (/^(?:[A-Za-z]:[\\/]|[.~]?[\\/])/.test(text)) return true;
  if (/^\[[^\]]+\]/.test(text)) return true;
  if (/^(?:npm|npx|node|git|ssh|go|pwsh|powershell|cmd|bash|zsh|fish)(?:\s|$)/i.test(text)) return true;
  if (/^[a-z0-9]+(?:[-_:./][a-z0-9]+)+$/i.test(text)) return true;
  return false;
}

function sourceLocation(sourceFile, node) {
  const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: location.line + 1, column: location.character + 1 };
}

function issue(sourceFile, node, kind, text) {
  return {
    file: sourceFile.fileName,
    ...sourceLocation(sourceFile, node),
    kind,
    text: text.trim().replace(/\s+/g, ' ')
  };
}

function ignoredOnLine(source, sourceFile, node) {
  const start = sourceFile.getLineStarts()[sourceLocation(sourceFile, node).line - 1] ?? 0;
  const end = source.indexOf('\n', start);
  return source.slice(start, end < 0 ? source.length : end).includes('i18n-ignore');
}

function literalText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function callName(node) {
  if (!ts.isCallExpression(node)) return null;
  if (ts.isIdentifier(node.expression)) return node.expression.text;
  if (ts.isPropertyAccessExpression(node.expression)) return node.expression.name.text;
  return null;
}

function isLocalizedExpression(node) {
  if (ts.isCallExpression(node) && TRANSLATION_CALLS.has(callName(node))) return true;
  if (ts.isParenthesizedExpression(node)) return isLocalizedExpression(node.expression);
  return false;
}

function scanFile(filePath) {
  const source = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    extname(filePath).toLowerCase() === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const findings = [];

  function add(node, kind, text) {
    if (!isTechnical(text) && !ignoredOnLine(source, sourceFile, node)) {
      findings.push(issue(sourceFile, node, kind, text));
    }
  }

  function visit(node) {
    if (ts.isJsxText(node)) {
      add(node, 'jsx-text', node.getText(sourceFile));
    }

    if (ts.isJsxAttribute(node) && VISIBLE_ATTRIBUTES.has(node.name.getText(sourceFile))) {
      if (node.initializer && ts.isStringLiteral(node.initializer)) {
        add(node, 'visible-attribute', node.initializer.text);
      } else if (
        node.initializer &&
        ts.isJsxExpression(node.initializer) &&
        node.initializer.expression &&
        !isLocalizedExpression(node.initializer.expression)
      ) {
        const value = literalText(node.initializer.expression);
        if (value !== null) add(node, 'visible-attribute', value);
      }
    }

    if (ts.isNewExpression(node) && node.expression.getText(sourceFile) === 'Error') {
      const value = node.arguments?.[0] === undefined ? null : literalText(node.arguments[0]);
      if (value !== null) add(node, 'authored-error', value);
    }

    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(sourceFile).replace(/["']/g, '') === 'label'
    ) {
      const value = literalText(node.initializer);
      if (value !== null) add(node, 'menu-label', value);
    }

    if (ts.isJsxExpression(node) && node.expression && !isLocalizedExpression(node.expression)) {
      const value = literalText(node.expression);
      if (value !== null) add(node, 'jsx-interpolation', value);
      const parent = node.parent;
      if (parent && (ts.isJsxElement(parent) || ts.isJsxFragment(parent))) {
        const siblings = parent.children;
        const index = siblings.indexOf(node);
        const neighborText = [siblings[index - 1], siblings[index + 1]]
          .filter((candidate) => candidate && ts.isJsxText(candidate))
          .map((candidate) => candidate.getText(sourceFile).trim())
          .find((candidate) => hasWords(candidate));
        if (neighborText) add(node, 'jsx-interpolation', neighborText);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

function scanFiles(paths) {
  return paths.flatMap((path) => scanFile(resolve(path)));
}

function collectFiles(root, output = []) {
  if (!existsSync(root)) return output;
  const stat = statSync(root);
  if (stat.isFile()) {
    if (/\.tsx?$/.test(root) && !TEST_FILE.test(root)) output.push(root);
    return output;
  }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    collectFiles(join(root, entry.name), output);
  }
  return output;
}

function defaultFiles(projectRoot) {
  const files = collectFiles(join(projectRoot, 'src', 'renderer', 'src'));
  const mainRoot = join(projectRoot, 'src', 'main');
  for (const file of collectFiles(mainRoot)) {
    const path = relative(mainRoot, file).replace(/\\/g, '/');
    if (/(?:menu|tray|notification|close-warning|window)/i.test(path)) files.push(file);
  }
  return [...new Set(files)];
}

function run(argv = process.argv.slice(2)) {
  const projectRoot = process.cwd();
  const files = argv.length > 0
    ? argv.flatMap((path) => collectFiles(resolve(projectRoot, path)))
    : defaultFiles(projectRoot);
  const findings = scanFiles(files);
  for (const finding of findings) {
    console.error(
      `${relative(projectRoot, finding.file)}:${finding.line}:${finding.column} ` +
      `[${finding.kind}] ${JSON.stringify(finding.text)}`
    );
  }
  if (findings.length > 0) {
    console.error(`Found ${findings.length} possible hardcoded user-facing string(s).`);
    process.exitCode = 1;
  }
  return findings;
}

if (require.main === module) run();

module.exports = { collectFiles, defaultFiles, isTechnical, run, scanFile, scanFiles };
