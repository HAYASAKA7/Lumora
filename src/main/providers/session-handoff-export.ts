import type { ProviderId } from '../../shared/contracts';

const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_NORMALIZED_BYTES = 32 * 1024 * 1024;
const TEXT_BLOCK_TYPES = new Set(['text', 'input_text', 'output_text']);
const PATH_FIELDS = new Set([
  'path',
  'paths',
  'file_path',
  'filepath',
  'filePath',
  'target_path',
  'targetPath'
]);

export interface HandoffMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string | null;
}

export interface HandoffActivity {
  toolName: string;
  referencedPaths: string[];
  timestamp: string | null;
  status: 'succeeded' | 'failed' | 'unknown';
}

export type HandoffCoverage = 'complete' | 'partial' | 'unavailable';

export interface NormalizedSessionHandoff {
  messages: HandoffMessage[];
  activities: HandoffActivity[];
  messageCoverage: 'complete';
  activityCoverage: HandoffCoverage;
  warnings: string[];
}

export class SessionHandoffExportError extends Error {
  readonly code = 'SESSION_HANDOFF_EXPORT_FAILED';

  constructor(message: string) {
    super(message);
    this.name = 'SessionHandoffExportError';
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseTimestamp(value: unknown): string | null {
  let milliseconds: number;
  if (typeof value === 'number') {
    milliseconds = value < 10_000_000_000 ? value * 1_000 : value;
  } else if (typeof value === 'string') {
    milliseconds = Date.parse(value);
  } else {
    return null;
  }
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : null;
}

function timestampFrom(record: Record<string, unknown>): string | null {
  const info = objectValue(record.info);
  const time = objectValue(info?.time);
  return parseTimestamp(
    record.timestamp ?? record.createdAt ?? record.created ??
      time?.created ?? info?.createdAt
  );
}

function normalizeRole(value: unknown): HandoffMessage['role'] | null {
  if (typeof value !== 'string') return null;
  const role = value.toLocaleLowerCase();
  if (role === 'user' || role === 'human') return 'user';
  if (
    role === 'assistant' ||
    role === 'model' ||
    role === 'gemini' ||
    role === 'agent'
  ) return 'assistant';
  return null;
}

function textParts(value: unknown): string[] {
  if (typeof value === 'string') {
    const text = value.trim();
    return text.length === 0 ? [] : [text];
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((part) => {
    if (typeof part === 'string') return textParts(part);
    const block = objectValue(part);
    if (block === null) return [];
    const type = typeof block.type === 'string'
      ? block.type.toLocaleLowerCase()
      : '';
    if (
      !TEXT_BLOCK_TYPES.has(type) &&
      !(type === '' && typeof block.text === 'string')
    ) return [];
    return textParts(block.text ?? block.content);
  });
}

function messageText(value: unknown): string | null {
  const parts = textParts(value);
  return parts.length === 0 ? null : parts.join('\n\n');
}

function safePath(value: unknown): string[] {
  if (typeof value === 'string') {
    const path = value.trim();
    return path.length > 0 && path.length <= 32_768 && !/[\0\r\n]/.test(path)
      ? [path]
      : [];
  }
  return Array.isArray(value) ? value.flatMap(safePath) : [];
}

function referencedPaths(value: unknown): string[] {
  let root = value;
  if (typeof root === 'string') {
    try {
      root = JSON.parse(root) as unknown;
    } catch {
      return [];
    }
  }
  const found: string[] = [];
  const visit = (candidate: unknown, depth: number): void => {
    if (depth > 8) return;
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item, depth + 1);
      return;
    }
    const object = objectValue(candidate);
    if (object === null) return;
    for (const [key, nested] of Object.entries(object)) {
      if (PATH_FIELDS.has(key)) found.push(...safePath(nested));
      else if (typeof nested === 'object' && nested !== null) {
        visit(nested, depth + 1);
      }
    }
  };
  visit(root, 0);
  return [...new Set(found)].slice(0, 128);
}

function activityStatus(value: unknown, isError?: unknown): HandoffActivity['status'] {
  if (isError === true) return 'failed';
  if (typeof value !== 'string') return 'unknown';
  const status = value.toLocaleLowerCase();
  if (/fail|error|cancel/.test(status)) return 'failed';
  if (/complete|success|succeed|done/.test(status)) return 'succeeded';
  return 'unknown';
}

function parseDocument(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    const records: unknown[] = [];
    for (const line of raw.split(/\r?\n/)) {
      if (line.trim().length === 0) continue;
      try {
        records.push(JSON.parse(line) as unknown);
      } catch {
        throw new SessionHandoffExportError(
          'The session source contains invalid JSONL.'
        );
      }
    }
    return records;
  }
}

function recordsFrom(document: unknown): Record<string, unknown>[] {
  const values = Array.isArray(document) ? document : [document];
  return values.flatMap((value) => {
    const record = objectValue(value);
    return record === null ? [] : [record];
  });
}

function addMessage(
  messages: HandoffMessage[],
  roleValue: unknown,
  content: unknown,
  timestamp: string | null
): void {
  const role = normalizeRole(roleValue);
  const text = messageText(content);
  if (role === null || text === null) return;
  messages.push({ role, content: text, timestamp });
}

function normalizeCodex(
  records: readonly Record<string, unknown>[],
  messages: HandoffMessage[],
  activities: HandoffActivity[]
): void {
  for (const record of records) {
    if (record.type !== 'response_item') continue;
    const payload = objectValue(record.payload);
    if (payload === null) continue;
    const timestamp = timestampFrom(record);
    if (payload.type === 'message') {
      addMessage(messages, payload.role, payload.content, timestamp);
      continue;
    }
    if (
      payload.type === 'function_call' ||
      payload.type === 'custom_tool_call' ||
      payload.type === 'web_search_call'
    ) {
      const requestedName = payload.name ?? payload.type;
      if (typeof requestedName !== 'string' || requestedName.trim().length === 0) {
        continue;
      }
      activities.push({
        toolName: requestedName.trim().slice(0, 256),
        referencedPaths: referencedPaths(payload.arguments ?? payload.input),
        timestamp,
        status: activityStatus(payload.status)
      });
    }
  }
}

function normalizeClaude(
  records: readonly Record<string, unknown>[],
  messages: HandoffMessage[],
  activities: HandoffActivity[]
): void {
  const activityById = new Map<string, HandoffActivity>();
  for (const record of records) {
    const message = objectValue(record.message);
    if (message === null) continue;
    const timestamp = timestampFrom(record);
    addMessage(messages, message.role, message.content, timestamp);
    if (!Array.isArray(message.content)) continue;
    for (const rawBlock of message.content) {
      const block = objectValue(rawBlock);
      if (block === null) continue;
      if (block.type === 'tool_use' && typeof block.name === 'string') {
        const activity: HandoffActivity = {
          toolName: block.name.trim().slice(0, 256),
          referencedPaths: referencedPaths(block.input),
          timestamp,
          status: 'unknown'
        };
        activities.push(activity);
        if (typeof block.id === 'string') activityById.set(block.id, activity);
      } else if (
        block.type === 'tool_result' &&
        typeof block.tool_use_id === 'string'
      ) {
        const activity = activityById.get(block.tool_use_id);
        if (activity !== undefined) {
          activity.status = activityStatus('completed', block.is_error);
        }
      }
    }
  }
}

function documentMessages(document: unknown): Record<string, unknown>[] {
  const root = objectValue(document);
  const messages = root?.messages ?? objectValue(root?.data)?.messages;
  return Array.isArray(messages) ? recordsFrom(messages) : recordsFrom(document);
}

function normalizeGemini(
  document: unknown,
  messages: HandoffMessage[],
  activities: HandoffActivity[]
): void {
  for (const record of documentMessages(document)) {
    const timestamp = timestampFrom(record);
    addMessage(messages, record.role ?? record.type, record.content ?? record.parts, timestamp);
    const calls = record.toolCalls ?? record.functionCalls;
    if (!Array.isArray(calls)) continue;
    for (const rawCall of calls) {
      const call = objectValue(rawCall);
      if (call === null || typeof call.name !== 'string') continue;
      activities.push({
        toolName: call.name.trim().slice(0, 256),
        referencedPaths: referencedPaths(call.args ?? call.arguments),
        timestamp,
        status: activityStatus(call.status)
      });
    }
  }
}

function normalizeCopilot(
  records: readonly Record<string, unknown>[],
  messages: HandoffMessage[],
  activities: HandoffActivity[]
): void {
  for (const record of records) {
    const type = typeof record.type === 'string'
      ? record.type.toLocaleLowerCase()
      : '';
    const data = objectValue(record.data) ?? record;
    const timestamp = timestampFrom(record);
    if (type.includes('user') && type.includes('message')) {
      addMessage(messages, 'user', data.content ?? data.message, timestamp);
    } else if (type.includes('assistant') && type.includes('message')) {
      addMessage(messages, 'assistant', data.content ?? data.message, timestamp);
    } else if (type.includes('tool')) {
      const name = data.toolName ?? data.name ?? data.tool;
      if (typeof name !== 'string' || name.trim().length === 0) continue;
      activities.push({
        toolName: name.trim().slice(0, 256),
        referencedPaths: referencedPaths(data),
        timestamp,
        status: activityStatus(data.status, data.isError)
      });
    }
  }
}

function normalizeQwen(
  records: readonly Record<string, unknown>[],
  messages: HandoffMessage[],
  activities: HandoffActivity[]
): void {
  for (const record of records) {
    const message = objectValue(record.message);
    if (message === null) continue;
    const timestamp = timestampFrom(record);
    addMessage(messages, message.role, message.parts ?? message.content, timestamp);
    if (!Array.isArray(message.parts)) continue;
    for (const rawPart of message.parts) {
      const part = objectValue(rawPart);
      const call = objectValue(part?.functionCall);
      if (call === null || typeof call.name !== 'string') continue;
      activities.push({
        toolName: call.name.trim().slice(0, 256),
        referencedPaths: referencedPaths(call.args),
        timestamp,
        status: activityStatus(call.status)
      });
    }
  }
}

function normalizeOpenCode(
  document: unknown,
  messages: HandoffMessage[],
  activities: HandoffActivity[]
): void {
  for (const record of documentMessages(document)) {
    const info = objectValue(record.info) ?? record;
    const parts = Array.isArray(record.parts) ? record.parts : record.content;
    const timestamp = timestampFrom(record);
    addMessage(messages, info.role ?? record.role, parts, timestamp);
    if (!Array.isArray(parts)) continue;
    for (const rawPart of parts) {
      const part = objectValue(rawPart);
      if (part === null || part.type !== 'tool') continue;
      const state = objectValue(part.state);
      const name = part.tool ?? part.name;
      if (typeof name !== 'string' || name.trim().length === 0) continue;
      activities.push({
        toolName: name.trim().slice(0, 256),
        referencedPaths: referencedPaths(state?.input ?? part.input),
        timestamp,
        status: activityStatus(state?.status ?? part.status)
      });
    }
  }
}

function normalizeKimi(
  records: readonly Record<string, unknown>[],
  messages: HandoffMessage[],
  activities: HandoffActivity[]
): void {
  for (const record of records) {
    const timestamp = parseTimestamp(record.time ?? record.timestamp);
    if (record.type === 'turn.prompt') {
      addMessage(messages, 'user', record.content ?? record.prompt ?? record.userInput, timestamp);
      continue;
    }
    if (record.type === 'context.append_message') {
      const message = objectValue(record.message ?? record.payload);
      if (message !== null) {
        addMessage(messages, message.role, message.content ?? message.parts, timestamp);
      }
      continue;
    }
    if (record.type === 'tool.call' || record.type === 'tool_call') {
      const payload = objectValue(record.payload) ?? record;
      const name = payload.toolName ?? payload.name ?? payload.tool;
      if (typeof name !== 'string' || name.trim().length === 0) continue;
      activities.push({
        toolName: name.trim().slice(0, 256),
        referencedPaths: referencedPaths(payload.arguments ?? payload.input),
        timestamp,
        status: activityStatus(payload.status)
      });
    }
  }
}

function activityCoverage(provider: ProviderId): HandoffCoverage {
  if (provider === 'codex' || provider === 'claude' || provider === 'opencode') {
    return 'complete';
  }
  return 'partial';
}

export function normalizeSessionHandoff(
  provider: ProviderId,
  raw: string
): NormalizedSessionHandoff {
  const sourceBytes = Buffer.byteLength(raw, 'utf8');
  if (sourceBytes < 1 || sourceBytes > MAX_SOURCE_BYTES) {
    throw new SessionHandoffExportError(
      'The session source is empty or exceeds the handoff size limit.'
    );
  }
  const document = parseDocument(raw);
  const records = recordsFrom(document);
  const messages: HandoffMessage[] = [];
  const activities: HandoffActivity[] = [];

  switch (provider) {
    case 'codex':
      normalizeCodex(records, messages, activities);
      break;
    case 'claude':
      normalizeClaude(records, messages, activities);
      break;
    case 'gemini':
      normalizeGemini(document, messages, activities);
      break;
    case 'copilot':
      normalizeCopilot(records, messages, activities);
      break;
    case 'qwen':
      normalizeQwen(records, messages, activities);
      break;
    case 'opencode':
      normalizeOpenCode(document, messages, activities);
      break;
    case 'kimi':
      normalizeKimi(records, messages, activities);
      break;
    default:
      throw new SessionHandoffExportError(
        'The selected provider does not support session handoff export.'
      );
  }

  if (messages.length === 0) {
    throw new SessionHandoffExportError(
      'The session source does not contain a readable conversation.'
    );
  }
  const coverage = activityCoverage(provider);
  const result: NormalizedSessionHandoff = {
    messages,
    activities,
    messageCoverage: 'complete',
    activityCoverage: coverage,
    warnings: coverage === 'complete'
      ? []
      : ['Tool activity may be incomplete for this provider version.']
  };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_NORMALIZED_BYTES) {
    throw new SessionHandoffExportError(
      'The normalized session exceeds the handoff size limit.'
    );
  }
  return result;
}
