export class TerminalOutputBuffer {
  private snapshotChunks: string[] = [];
  private snapshotHead = 0;
  private snapshotLength = 0;
  private pendingChunks: string[] = [];

  constructor(
    private readonly maxSnapshotChars: number,
    private readonly maxEventChars: number
  ) {
    if (maxSnapshotChars < 1 || maxEventChars < 1) {
      throw new RangeError('Terminal output limits must be positive.');
    }
  }

  append(data: string): void {
    if (data.length === 0) return;
    this.pendingChunks.push(data);

    if (data.length >= this.maxSnapshotChars) {
      this.snapshotChunks = [data.slice(-this.maxSnapshotChars)];
      this.snapshotHead = 0;
      this.snapshotLength = this.maxSnapshotChars;
      return;
    }

    this.snapshotChunks.push(data);
    this.snapshotLength += data.length;
    while (
      this.snapshotHead < this.snapshotChunks.length &&
      this.snapshotLength - this.snapshotChunks[this.snapshotHead]!.length >=
        this.maxSnapshotChars
    ) {
      this.snapshotLength -= this.snapshotChunks[this.snapshotHead]!.length;
      this.snapshotHead += 1;
    }

    if (this.snapshotLength > this.maxSnapshotChars) {
      const overflow = this.snapshotLength - this.maxSnapshotChars;
      this.snapshotChunks[this.snapshotHead] =
        this.snapshotChunks[this.snapshotHead]!.slice(overflow);
      this.snapshotLength = this.maxSnapshotChars;
    }

    if (
      this.snapshotHead >= 64 &&
      this.snapshotHead * 2 >= this.snapshotChunks.length
    ) {
      this.snapshotChunks = this.snapshotChunks.slice(this.snapshotHead);
      this.snapshotHead = 0;
    }
  }

  drainEvents(): string[] {
    if (this.pendingChunks.length === 0) return [];
    const combined = this.pendingChunks.join('');
    this.pendingChunks = [];
    const events: string[] = [];
    for (let offset = 0; offset < combined.length; offset += this.maxEventChars) {
      events.push(combined.slice(offset, offset + this.maxEventChars));
    }
    return events;
  }

  snapshot(): string {
    return this.snapshotChunks.slice(this.snapshotHead).join('');
  }
}
