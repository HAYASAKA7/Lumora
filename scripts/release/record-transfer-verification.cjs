const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const SUPPORTED_PROVIDERS = new Set(['opencode']);
const PLATFORMS = new Set(['win32', 'darwin', 'linux']);
const TARGET_PARTS = [
  'src',
  'main',
  'transfer',
  'verified-transfer-routes.ts'
];

function assertText(value, label, maximum) {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > maximum ||
    /[\r\n\0]/.test(value)
  ) {
    throw new Error(`transfer verification ${label} is invalid`);
  }
}

function validateRecord(record) {
  if (!SUPPORTED_PROVIDERS.has(record.provider)) {
    throw new Error(`transfer verification provider ${JSON.stringify(record.provider)} is unsupported`);
  }
  if (!PLATFORMS.has(record.sourcePlatform)) {
    throw new Error(`transfer verification source platform ${JSON.stringify(record.sourcePlatform)} is invalid`);
  }
  if (!PLATFORMS.has(record.destinationPlatform)) {
    throw new Error(
      `transfer verification destination platform ${JSON.stringify(record.destinationPlatform)} is invalid`
    );
  }
  assertText(record.providerVersion, 'provider version', 256);
  if (
    typeof record.lumoraCommit !== 'string' ||
    !/^[a-f0-9]{40}$/.test(record.lumoraCommit)
  ) {
    throw new Error('transfer verification Lumora commit is invalid');
  }
  if (
    typeof record.verifiedAt !== 'string' ||
    Number.isNaN(Date.parse(record.verifiedAt)) ||
    new Date(record.verifiedAt).toISOString() !== record.verifiedAt
  ) {
    throw new Error('transfer verification timestamp is invalid');
  }
  if (
    typeof record.evidenceId !== 'string' ||
    !/^[a-f0-9]{64}$/.test(record.evidenceId)
  ) {
    throw new Error('transfer verification evidence ID is invalid');
  }
  return record;
}

function parseString(source) {
  return JSON.parse(source);
}

function parseGeneratedRoutes(source) {
  const table = source.match(/Object\.freeze\(\[([\s\S]*?)\]\);/);
  if (!table) {
    throw new Error('verified transfer route table has an unexpected format');
  }
  const body = table[1];
  const objectPattern =
    /\{\s*provider:\s*("(?:[^"\\]|\\.)*"),\s*sourcePlatform:\s*("(?:[^"\\]|\\.)*"),\s*destinationPlatform:\s*("(?:[^"\\]|\\.)*"),\s*providerVersion:\s*("(?:[^"\\]|\\.)*"),\s*verifiedAt:\s*("(?:[^"\\]|\\.)*"),\s*lumoraCommit:\s*("(?:[^"\\]|\\.)*"),\s*evidenceId:\s*("(?:[^"\\]|\\.)*")\s*\}/g;
  const records = [];
  for (const match of body.matchAll(objectPattern)) {
    records.push(
      validateRecord({
        provider: parseString(match[1]),
        sourcePlatform: parseString(match[2]),
        destinationPlatform: parseString(match[3]),
        providerVersion: parseString(match[4]),
        verifiedAt: parseString(match[5]),
        lumoraCommit: parseString(match[6]),
        evidenceId: parseString(match[7])
      })
    );
  }
  const withoutComment = body.replace(
    /\/\/ Literal evidence-backed rows generated in provider\/source\/destination order\.\s*/g,
    ''
  );
  if (withoutComment.replace(objectPattern, '').replace(/[\s,]/g, '') !== '') {
    throw new Error('verified transfer route table contains an unrecognized row');
  }
  return records;
}

function routeKey(record) {
  return [
    record.provider,
    record.sourcePlatform,
    record.destinationPlatform,
    record.providerVersion
  ].join('\0');
}

function renderRecord(record) {
  return [
    '    {',
    `      provider: ${JSON.stringify(record.provider)},`,
    `      sourcePlatform: ${JSON.stringify(record.sourcePlatform)},`,
    `      destinationPlatform: ${JSON.stringify(record.destinationPlatform)},`,
    `      providerVersion: ${JSON.stringify(record.providerVersion)},`,
    `      verifiedAt: ${JSON.stringify(record.verifiedAt)},`,
    `      lumoraCommit: ${JSON.stringify(record.lumoraCommit)},`,
    `      evidenceId: ${JSON.stringify(record.evidenceId)}`,
    '    }'
  ].join('\n');
}

function renderRoutes(records) {
  const rows =
    records.length === 0
      ? ''
      : `\n    // Literal evidence-backed rows generated in provider/source/destination order.\n${records
          .map(renderRecord)
          .join(',\n')}\n  `;
  return `import type { VerifiedTransferRoute } from './transfer-adapter';

export const VERIFIED_TRANSFER_ROUTES: readonly VerifiedTransferRoute[] =
  Object.freeze([${rows}]);
`;
}

function recordTransferVerification({
  rootDir = process.cwd(),
  provider,
  sourcePlatform,
  destinationPlatform,
  providerVersion,
  lumoraCommit,
  now = new Date()
}) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error('transfer verification clock is invalid');
  }
  const verifiedAt = now.toISOString();
  const canonical = JSON.stringify({
    provider,
    sourcePlatform,
    destinationPlatform,
    providerVersion,
    lumoraCommit,
    verifiedAt
  });
  const record = validateRecord({
    provider,
    sourcePlatform,
    destinationPlatform,
    providerVersion,
    verifiedAt,
    lumoraCommit,
    evidenceId: createHash('sha256').update(canonical).digest('hex')
  });
  const target = join(rootDir, ...TARGET_PARTS);
  const records = parseGeneratedRoutes(readFileSync(target, 'utf8'));
  if (records.some((candidate) => routeKey(candidate) === routeKey(record))) {
    throw new Error('verified transfer route already exists');
  }
  records.push(record);
  records.sort((left, right) => routeKey(left).localeCompare(routeKey(right)));
  writeFileSync(target, renderRoutes(records), 'utf8');
  return record;
}

function parseArguments(argv) {
  const allowed = new Set([
    '--provider',
    '--source',
    '--destination',
    '--version',
    '--commit'
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(flag) || value === undefined || values.has(flag)) {
      throw new Error(`invalid transfer verification argument ${JSON.stringify(flag)}`);
    }
    values.set(flag, value);
  }
  if (values.size !== allowed.size) {
    throw new Error('all transfer verification arguments are required');
  }
  return {
    provider: values.get('--provider'),
    sourcePlatform: values.get('--source'),
    destinationPlatform: values.get('--destination'),
    providerVersion: values.get('--version'),
    lumoraCommit: values.get('--commit')
  };
}

function runCli() {
  try {
    const record = recordTransferVerification(parseArguments(process.argv.slice(2)));
    console.log(
      `Recorded ${record.provider} ${record.sourcePlatform} -> ${record.destinationPlatform} verification ${record.evidenceId}.`
    );
  } catch (error) {
    console.error(`Transfer verification recording failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  parseArguments,
  parseGeneratedRoutes,
  recordTransferVerification,
  renderRoutes,
  validateRecord
};
