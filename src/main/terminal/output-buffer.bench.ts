import { bench, describe } from 'vitest';

import { RuntimeEventSchema } from '../../shared/contracts';
import { TerminalOutputBuffer } from './output-buffer';

const runtimeId = '0198f8b6-18f3-7ca0-9f0f-123456789abc';
let benchmarkSink = 0;
const fragments = Array.from(
  { length: 4_096 },
  (_value, index) => `${String(index).padStart(6, '0')}:${'x'.repeat(249)}`
);

function validateEvent(data: string, sequence: number): void {
  RuntimeEventSchema.parse({
    type: 'output',
    runtimeId,
    sequence,
    data
  });
}

describe('TerminalOutputBuffer', () => {
  bench('batches one MiB of fragmented resume output', () => {
    const buffer = new TerminalOutputBuffer(1_048_576, 65_536);
    for (const fragment of fragments) buffer.append(fragment);
    let sequence = 0;
    for (const event of buffer.drainEvents()) {
      validateEvent(event, sequence += 1);
    }
    benchmarkSink = buffer.snapshot().charCodeAt(0);
  });

  bench('legacy per-fragment validation and snapshot update', () => {
    let snapshot = '';
    let sequence = 0;
    for (const fragment of fragments) {
      snapshot = (snapshot + fragment).slice(-1_048_576);
      validateEvent(fragment, sequence += 1);
    }
    benchmarkSink = snapshot.charCodeAt(0);
  });
});
