'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { TYPE, parse } = require('@formatjs/icu-messageformat-parser');

const NAMESPACES = Object.freeze([
  'common',
  'shell',
  'catalog',
  'terminal',
  'settings',
  'providers',
  'remote',
  'transfer',
  'errors'
]);
const UNSAFE_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
const LIMITS = Object.freeze({
  packs: 64,
  fileBytes: 512 * 1024,
  packBytes: 4 * 1024 * 1024,
  rootBytes: 32 * 1024 * 1024,
  depth: 8,
  keySegmentCodepoints: 128,
  messageCodepoints: 16_384,
  messagesPerPack: 10_000
});

function issue(code, locale = null, filePath = null) {
  return { code, locale, path: filePath };
}

function readJson(filePath, locale, errors, counters) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch {
    errors.push(issue('missing-file', locale, filePath));
    return null;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    errors.push(issue('invalid-file', locale, filePath));
    return null;
  }
  counters.packBytes += stat.size;
  counters.rootBytes += stat.size;
  if (stat.size > LIMITS.fileBytes) {
    errors.push(issue('file-size-limit', locale, filePath));
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    errors.push(issue('invalid-json', locale, filePath));
    return null;
  }
}

function validLocaleTag(value) {
  if (typeof value !== 'string' || value.length > 64) return false;
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
}

function validateManifest(value, folderName, filePath, errors) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    errors.push(issue('invalid-manifest', folderName, filePath));
    return null;
  }
  if (value.schemaVersion !== 1) {
    errors.push(issue('unsupported-schema', folderName, filePath));
  }
  if (
    !Number.isInteger(value.catalogVersion) ||
    value.catalogVersion < 1 ||
    !validLocaleTag(value.locale) ||
    typeof value.displayName !== 'string' ||
    value.displayName.trim().length === 0 ||
    value.displayName.length > 128 ||
    (value.direction !== 'ltr' && value.direction !== 'rtl') ||
    value.locale !== folderName
  ) {
    errors.push(issue('invalid-manifest', folderName, filePath));
    return null;
  }
  return value;
}

function placeholderSignature(message) {
  const signature = new Map();
  const visit = (elements) => {
    for (const element of elements) {
      if (element.type !== TYPE.literal && element.type !== TYPE.pound) {
        const kind = TYPE[element.type];
        const previous = signature.get(element.value);
        signature.set(element.value, previous === undefined ? kind : previous);
      }
      if (element.options !== undefined) {
        for (const option of Object.values(element.options)) {
          visit(option.value);
        }
      }
      if (element.children !== undefined) visit(element.children);
    }
  };
  visit(parse(message, { captureLocation: false }));
  return [...signature.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function flattenMessages(value, namespace, locale, filePath, errors) {
  const messages = new Map();
  const visit = (current, segments, depth) => {
    if (depth > LIMITS.depth) {
      errors.push(issue('nesting-limit', locale, filePath));
      return;
    }
    if (typeof current === 'string') {
      if ([...current].length > LIMITS.messageCodepoints) {
        errors.push(issue('message-size-limit', locale, filePath));
        return;
      }
      const key = `${namespace}.${segments.join('.')}`;
      try {
        const placeholders = placeholderSignature(current);
        messages.set(key, { message: current, placeholders });
      } catch {
        errors.push(issue('invalid-icu', locale, `${filePath}:${key}`));
      }
      return;
    }
    if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      errors.push(issue('invalid-message-value', locale, filePath));
      return;
    }
    for (const [segment, child] of Object.entries(current)) {
      if (
        UNSAFE_SEGMENTS.has(segment) ||
        [...segment].length > LIMITS.keySegmentCodepoints ||
        !/^[a-z][a-z0-9-]*$/.test(segment)
      ) {
        errors.push(issue('unsafe-key', locale, `${filePath}:${segment}`));
        continue;
      }
      visit(child, [...segments, segment], depth + 1);
    }
  };
  visit(value, [], 1);
  return messages;
}

function validateLocaleRoot(root) {
  const errors = [];
  const counters = { rootBytes: 0 };
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return { valid: false, errors: [issue('missing-root', null, root)] };
  }
  const folders = entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink());
  if (folders.length > LIMITS.packs) errors.push(issue('pack-count-limit', null, root));
  const packs = new Map();

  for (const entry of folders.slice(0, LIMITS.packs)) {
    const locale = entry.name;
    const folder = path.join(root, locale);
    const packCounters = { packBytes: 0, rootBytes: counters.rootBytes };
    const manifestPath = path.join(folder, 'manifest.json');
    const manifest = validateManifest(
      readJson(manifestPath, locale, errors, packCounters),
      locale,
      manifestPath,
      errors
    );
    const messages = new Map();
    for (const namespace of NAMESPACES) {
      const filePath = path.join(folder, `${namespace}.json`);
      if (!fs.existsSync(filePath)) {
        errors.push(issue('missing-namespace', locale, filePath));
        continue;
      }
      const value = readJson(filePath, locale, errors, packCounters);
      if (value === null) continue;
      for (const [key, message] of flattenMessages(
        value,
        namespace,
        locale,
        filePath,
        errors
      )) {
        if (messages.has(key)) errors.push(issue('duplicate-key', locale, filePath));
        messages.set(key, message);
      }
    }
    counters.rootBytes = packCounters.rootBytes;
    if (packCounters.packBytes > LIMITS.packBytes) {
      errors.push(issue('pack-size-limit', locale, folder));
    }
    if (messages.size > LIMITS.messagesPerPack) {
      errors.push(issue('message-count-limit', locale, folder));
    }
    if (manifest !== null) packs.set(locale, { manifest, messages });
  }
  if (counters.rootBytes > LIMITS.rootBytes) {
    errors.push(issue('root-size-limit', null, root));
  }

  const english = packs.get('en');
  if (english === undefined) {
    errors.push(issue('missing-english', 'en', root));
  } else {
    const englishKeys = [...english.messages.keys()].sort();
    for (const [locale, pack] of packs) {
      if (locale === 'en') continue;
      const localeKeys = [...pack.messages.keys()].sort();
      if (JSON.stringify(localeKeys) !== JSON.stringify(englishKeys)) {
        errors.push(issue('key-mismatch', locale, path.join(root, locale)));
      }
      for (const key of englishKeys) {
        const source = english.messages.get(key);
        const translated = pack.messages.get(key);
        if (
          source !== undefined &&
          translated !== undefined &&
          JSON.stringify(source.placeholders) !== JSON.stringify(translated.placeholders)
        ) {
          errors.push(issue('placeholder-mismatch', locale, key));
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { LIMITS, NAMESPACES, validateLocaleRoot };

if (require.main === module) {
  const root = path.resolve(process.argv[2] || 'resources/locales');
  const result = validateLocaleRoot(root);
  if (!result.valid) {
    for (const error of result.errors) {
      process.stderr.write(
        `[${error.code}] ${error.locale || 'root'}${error.path ? `: ${error.path}` : ''}\n`
      );
    }
    process.exitCode = 1;
  }
}
