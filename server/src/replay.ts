/** Process-local atomic replay retention. Full stores fail closed; live entries are never evicted. */
export class MemoryNonceStore {
  private readonly entries = new Map<string, number>();
  constructor(
    private readonly capacity = 10000,
    private readonly now = () => Date.now() / 1000,
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1)
      throw new RangeError('Invalid replay capacity');
  }
  async insertIfAbsent(key: string, ttlSeconds: number): Promise<boolean> {
    const time = this.now();
    if (!Number.isFinite(time) || !Number.isFinite(ttlSeconds) || ttlSeconds <= 0)
      throw new RangeError('Invalid replay lifetime');
    for (const [saved, expires] of this.entries) if (expires < time) this.entries.delete(saved);
    if (this.entries.has(key)) return false;
    if (this.entries.size >= this.capacity) throw new Error('Replay capacity exhausted');
    // No await between lookup and insertion: atomic within this process, including concurrent verifies.
    this.entries.set(key, time + ttlSeconds);
    return true;
  }
}
