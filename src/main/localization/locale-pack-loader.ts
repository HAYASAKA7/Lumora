import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync
} from 'node:fs';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import { parse as parseIcu } from '@formatjs/icu-messageformat-parser';

import {
  LocaleManifestSchema,
  type LocaleManifest,
  type LocaleSummary,
  type LocaleWarning
} from '../../shared/contracts';
import { canonicalizeLocaleTag } from './locale-tags';

export const NAMESPACES = [
  'common',
  'shell',
  'catalog',
  'terminal',
  'settings',
  'providers',
  'remote',
  'transfer',
  'errors'
] as const;

const LIMITS = {
  packs: 64,
  fileBytes: 512 * 1024,
  packBytes: 4 * 1024 * 1024,
  rootBytes: 32 * 1024 * 1024,
  depth: 8,
  segmentCodepoints: 128,
  messageCodepoints: 16_384,
  messages: 10_000
} as const;
const UNSAFE_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

export type LoadedLocalePack = {
  manifest: LocaleManifest;
  messages: Readonly<Record<string, string>>;
};

export type LoadedLocalePacks = {
  bundled: ReadonlyMap<string, LoadedLocalePack>;
  user: ReadonlyMap<string, LoadedLocalePack>;
  summaries: LocaleSummary[];
  warnings: LocaleWarning[];
  loadedUserPacks: number;
  rejectedUserPacks: number;
};

type PackProblem = {
  code: 'invalid-user-pack' | 'unsupported-schema';
  message: string;
  path: string;
};

function isWithinRoot(root: string, candidate: string): boolean {
  const difference = relative(root, candidate);
  return difference === '' || (
    !difference.startsWith(`..${sep}`) &&
    difference !== '..' &&
    !isAbsolute(difference)
  );
}

function readSafeJson(
  rootRealPath: string,
  filePath: string,
  counters: { packBytes: number; rootBytes: number }
): unknown {
  const link = lstatSync(filePath);
  if (!link.isFile() || link.isSymbolicLink()) {
    throw new Error('Locale resources must be regular files.');
  }
  const realPath = realpathSync(filePath);
  if (!isWithinRoot(rootRealPath, realPath)) {
    throw new Error('Locale resource escaped its managed root.');
  }
  const size = statSync(realPath).size;
  counters.packBytes += size;
  counters.rootBytes += size;
  if (size > LIMITS.fileBytes) throw new Error('Locale file is too large.');
  return JSON.parse(readFileSync(realPath, 'utf8')) as unknown;
}

function flattenNamespace(
  namespace: string,
  input: unknown,
  messages: Record<string, string>,
  depth = 1,
  segments: string[] = []
): void {
  if (depth > LIMITS.depth) throw new Error('Locale nesting is too deep.');
  if (typeof input === 'string') {
    if (segments.length === 0) throw new Error('Locale message key is empty.');
    if ([...input].length > LIMITS.messageCodepoints) {
      throw new Error('Locale message is too large.');
    }
    parseIcu(input, { captureLocation: false });
    const key = `${namespace}.${segments.join('.')}`;
    if (Object.hasOwn(messages, key)) throw new Error('Duplicate locale key.');
    messages[key] = input;
    return;
  }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Locale messages must be nested objects of strings.');
  }
  for (const [segment, value] of Object.entries(input)) {
    if (
      UNSAFE_SEGMENTS.has(segment) ||
      [...segment].length > LIMITS.segmentCodepoints ||
      !/^[a-z][a-z0-9-]*$/.test(segment)
    ) {
      throw new Error('Locale message key is unsafe.');
    }
    flattenNamespace(namespace, value, messages, depth + 1, [...segments, segment]);
  }
}

function loadPack(
  rootRealPath: string,
  folderPath: string,
  complete: boolean,
  rootCounter: { value: number }
): LoadedLocalePack {
  const folderLink = lstatSync(folderPath);
  if (!folderLink.isDirectory() || folderLink.isSymbolicLink()) {
    throw new Error('Locale pack must be a regular directory.');
  }
  const folderRealPath = realpathSync(folderPath);
  if (!isWithinRoot(rootRealPath, folderRealPath)) {
    throw new Error('Locale pack escaped its managed root.');
  }
  const allowed = new Set([
    'manifest.json',
    ...NAMESPACES.map((namespace) => `${namespace}.json`)
  ]);
  for (const entry of readdirSync(folderRealPath, { withFileTypes: true })) {
    if (!entry.isFile() || entry.isSymbolicLink() || !allowed.has(entry.name)) {
      throw new Error('Locale packs may contain only supported JSON resources.');
    }
  }
  const counters = { packBytes: 0, rootBytes: rootCounter.value };
  const rawManifest = readSafeJson(
    rootRealPath,
    join(folderRealPath, 'manifest.json'),
    counters
  );
  if (
    typeof rawManifest === 'object' &&
    rawManifest !== null &&
    'schemaVersion' in rawManifest &&
    rawManifest.schemaVersion !== 1
  ) {
    throw Object.assign(new Error('Unsupported locale schema.'), {
      localizationCode: 'unsupported-schema'
    });
  }
  const manifest = LocaleManifestSchema.parse(rawManifest);
  const canonical = canonicalizeLocaleTag(manifest.locale);
  if (canonical === null || canonical !== manifest.locale || basename(folderPath) !== manifest.locale) {
    throw new Error('Locale folder and manifest tags must be canonical and equal.');
  }
  const messages: Record<string, string> = {};
  for (const namespace of NAMESPACES) {
    const filePath = join(folderRealPath, `${namespace}.json`);
    if (!existsSync(filePath)) {
      if (complete) throw new Error(`Missing locale namespace: ${namespace}.`);
      continue;
    }
    const raw = readSafeJson(rootRealPath, filePath, counters);
    flattenNamespace(namespace, raw, messages);
  }
  rootCounter.value = counters.rootBytes;
  if (counters.packBytes > LIMITS.packBytes) throw new Error('Locale pack is too large.');
  if (Object.keys(messages).length > LIMITS.messages) {
    throw new Error('Locale pack has too many messages.');
  }
  return { manifest, messages: Object.freeze(messages) };
}

function warning(
  code: LocaleWarning['code'],
  locale: string | null,
  filePath: string | null,
  message: string
): LocaleWarning {
  return { code, locale, path: filePath, message };
}

function loadRoot(root: string, complete: boolean): Map<string, LoadedLocalePack> {
  const packs = new Map<string, LoadedLocalePack>();
  if (!existsSync(root)) return packs;
  const rootLink = lstatSync(root);
  if (!rootLink.isDirectory() || rootLink.isSymbolicLink()) {
    throw new Error('Locale root must be a regular directory.');
  }
  const rootRealPath = realpathSync(root);
  const folders = readdirSync(rootRealPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .sort((left, right) => left.name.localeCompare(right.name));
  if (folders.length > LIMITS.packs) throw new Error('Too many locale packs.');
  const rootCounter = { value: 0 };
  for (const folder of folders) {
    let pack: LoadedLocalePack;
    try {
      pack = loadPack(
        rootRealPath,
        join(rootRealPath, folder.name),
        complete,
        rootCounter
      );
    } catch (error) {
      if (complete) {
        throw new Error(`Bundled locale ${folder.name} is invalid.`, {
          cause: error
        });
      }
      throw error;
    }
    packs.set(pack.manifest.locale, pack);
  }
  if (rootCounter.value > LIMITS.rootBytes) throw new Error('Locale root is too large.');
  return packs;
}

export function loadLocalePacks(input: {
  bundledRoot: string;
  userRoot?: string;
  userRoots?: readonly string[];
}): LoadedLocalePacks {
  const bundled = loadRoot(input.bundledRoot, true);
  if (!bundled.has('en')) throw new Error('Bundled English locale is required.');
  const user = new Map<string, LoadedLocalePack>();
  const warnings: LocaleWarning[] = [];
  let rejectedUserPacks = 0;
  const userRoots = input.userRoots ?? (
    input.userRoot === undefined ? [] : [input.userRoot]
  );
  for (const userRoot of userRoots) {
  if (existsSync(userRoot)) {
    const userRootLink = lstatSync(userRoot);
    if (!userRootLink.isDirectory() || userRootLink.isSymbolicLink()) {
      throw new Error('Locale root must be a regular directory.');
    }
    const rootRealPath = realpathSync(userRoot);
    const folders = readdirSync(rootRealPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .slice(0, LIMITS.packs);
    const rootCounter = { value: 0 };
    const knownKeys = new Set(bundled.get('en')?.messages === undefined
      ? []
      : Object.keys(bundled.get('en')!.messages));
    for (const folder of folders) {
      const folderPath = join(rootRealPath, folder.name);
      try {
        const pack = loadPack(rootRealPath, folderPath, false, rootCounter);
        if (pack.manifest.catalogVersion !== bundled.get('en')!.manifest.catalogVersion) {
          warnings.push(warning(
            'catalog-version-mismatch',
            pack.manifest.locale,
            folderPath,
            'The user locale targets a different catalog version.'
          ));
        }
        const recognized: Record<string, string> = {};
        for (const [key, message] of Object.entries(pack.messages)) {
          if (knownKeys.has(key)) recognized[key] = message;
          else warnings.push(warning(
            'unknown-message-key',
            pack.manifest.locale,
            key,
            'The user locale contains an unknown message key.'
          ));
        }
        const prior = user.get(pack.manifest.locale);
        user.set(pack.manifest.locale, {
          manifest: pack.manifest,
          messages: Object.freeze({
            ...(prior?.messages ?? {}),
            ...recognized
          })
        });
      } catch (error) {
        rejectedUserPacks += 1;
        const problem = error as Error & { localizationCode?: PackProblem['code'] };
        warnings.push(warning(
          problem.localizationCode === 'unsupported-schema'
            ? 'unsupported-schema'
            : 'invalid-user-pack',
          canonicalizeLocaleTag(folder.name),
          folderPath,
          problem.message
        ));
      }
    }
  }
  }
  const locales = new Set([...bundled.keys(), ...user.keys()]);
  const summaries = [...locales].sort((left, right) => {
    if (left === 'en') return -1;
    if (right === 'en') return 1;
    return left.localeCompare(right);
  }).map((locale): LocaleSummary => {
    const bundledPack = bundled.get(locale);
    const userPack = user.get(locale);
    const source = userPack ?? bundledPack;
    if (source === undefined) throw new Error('Locale summary source is missing.');
    return {
      locale,
      displayName: source.manifest.displayName,
      direction: source.manifest.direction,
      sources: [
        ...(bundledPack === undefined ? [] : ['bundled'] as const),
        ...(userPack === undefined ? [] : ['user'] as const)
      ],
      catalogVersion: source.manifest.catalogVersion
    };
  });
  return {
    bundled,
    user,
    summaries,
    warnings,
    loadedUserPacks: user.size,
    rejectedUserPacks
  };
}
