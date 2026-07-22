type JsonRecord = Record<string, unknown>;

function recordOf(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function safeCount(value: unknown, fallback?: number): number | null {
  if (value === undefined && fallback !== undefined) return fallback;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function safeSum(values: Iterable<number>): number | null {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

function effectiveTokens(
  inputValue: unknown,
  cachedValue: unknown,
  outputValue: unknown,
  reasoningValue: unknown = 0
): number | null {
  const input = safeCount(inputValue);
  const cached = safeCount(cachedValue, 0);
  const output = safeCount(outputValue);
  const reasoning = safeCount(reasoningValue, 0);
  if (input === null || cached === null || output === null || reasoning === null) {
    return null;
  }
  return safeSum([Math.max(0, input - cached), output, reasoning]);
}

function totalSnapshots(snapshots: ReadonlyMap<string, number>): number | null {
  return snapshots.size === 0 ? null : safeSum(snapshots.values());
}

export function parseJsonLines(text: string): unknown[] {
  const records: unknown[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // Active session files may end with one incomplete line.
    }
  }
  return records;
}

export function claudeLifetimeTokens(records: readonly unknown[]): number | null {
  const snapshots = new Map<string, number>();
  for (const value of records) {
    const record = recordOf(value);
    const message = recordOf(record?.message);
    const usage = recordOf(message?.usage);
    if (typeof message?.id !== 'string' || message.id.length === 0 || usage === null) {
      continue;
    }
    const tokens = effectiveTokens(
      usage.input_tokens,
      0,
      usage.output_tokens
    );
    if (tokens !== null) snapshots.set(message.id, tokens);
  }
  return totalSnapshots(snapshots);
}

export function geminiLifetimeTokens(records: readonly unknown[]): number | null {
  const snapshots = new Map<string, number>();
  for (const value of records) {
    const record = recordOf(value);
    const tokens = recordOf(record?.tokens);
    if (typeof record?.id !== 'string' || record.id.length === 0 || tokens === null) {
      continue;
    }
    const effective = effectiveTokens(
      tokens.input,
      tokens.cached,
      tokens.output,
      tokens.thoughts
    );
    if (effective !== null) snapshots.set(record.id, effective);
  }
  return totalSnapshots(snapshots);
}

export function qwenLifetimeTokens(records: readonly unknown[]): number | null {
  const snapshots = new Map<string, number>();
  for (const value of records) {
    const record = recordOf(value);
    const usage = recordOf(record?.usageMetadata);
    if (
      record?.type !== 'assistant' ||
      typeof record.uuid !== 'string' ||
      record.uuid.length === 0 ||
      usage === null
    ) {
      continue;
    }
    const effective = effectiveTokens(
      usage.promptTokenCount,
      usage.cachedContentTokenCount,
      usage.candidatesTokenCount,
      usage.thoughtsTokenCount
    );
    if (effective !== null) snapshots.set(record.uuid, effective);
  }
  return totalSnapshots(snapshots);
}

function copilotShutdownTokens(value: unknown): number | null {
  const record = recordOf(value);
  if (record?.type !== 'session.shutdown') return null;
  const data = recordOf(record.data);
  const metrics = data?.modelMetrics;
  const entries = Array.isArray(metrics)
    ? metrics
    : recordOf(metrics) === null
      ? []
      : Object.values(metrics as JsonRecord);
  const totals: number[] = [];
  for (const entry of entries) {
    const usage = recordOf(recordOf(entry)?.usage);
    if (usage === null) continue;
    const effective = effectiveTokens(
      usage.inputTokens,
      usage.cacheReadTokens,
      usage.outputTokens
    );
    if (effective !== null) totals.push(effective);
  }
  return totals.length === 0 ? null : safeSum(totals);
}

export function copilotLifetimeTokens(records: readonly unknown[]): number | null {
  let newest: number | null = null;
  for (const record of records) {
    const tokens = copilotShutdownTokens(record);
    if (tokens !== null) newest = tokens;
  }
  return newest;
}
