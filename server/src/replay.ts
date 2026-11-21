import { Failure } from './errors.js';
const brand = Symbol.for('visitor-verdict.MemoryNonceStore');
export interface ReplayContext {
  /** Verification clock snapshot; avoids resampling another clock during insertion. */
  now?: number;
  scope?: string;
  expiresAt?: number;
}
type Entry = { key: string; scope: string; expires: number };
/** Process-local atomic replay retention. Live entries are never evicted. */
export class MemoryNonceStore {
  readonly [brand] = true;
  private readonly entries = new Map<string, Entry>();
  private readonly scopes = new Map<string, number>();
  private readonly heap: Entry[] = [];
  private exhaustions = 0;
  constructor(
    private readonly capacity = 10000,
    private readonly now = () => Date.now() / 1000,
    private readonly perOperatorCapacity = Math.max(1, Math.floor(capacity / 4)),
  ) {
    if (
      !Number.isSafeInteger(capacity) ||
      capacity < 1 ||
      !Number.isSafeInteger(perOperatorCapacity) ||
      perOperatorCapacity < 1 ||
      perOperatorCapacity > capacity
    )
      throw new RangeError('Invalid replay capacity');
  }
  private sweep(time: number) {
    while (this.heap.length && this.heap[0].expires < time) {
      const first = this.heap[0];
      const last = this.heap.pop()!;
      if (this.heap.length) {
        let i = 0;
        while (i * 2 + 1 < this.heap.length) {
          let child = i * 2 + 1;
          if (
            child + 1 < this.heap.length &&
            this.heap[child + 1].expires < this.heap[child].expires
          )
            child++;
          if (last.expires <= this.heap[child].expires) break;
          this.heap[i] = this.heap[child];
          i = child;
        }
        this.heap[i] = last;
      }
      this.entries.delete(first.key);
      const remaining = this.scopes.get(first.scope)! - 1;
      if (remaining) this.scopes.set(first.scope, remaining);
      else this.scopes.delete(first.scope);
    }
  }
  async insertIfAbsent(
    key: string,
    ttlSeconds: number,
    context: ReplayContext = {},
  ): Promise<boolean> {
    const time = context.now ?? this.now();
    const expires = Math.max(time + ttlSeconds, context.expiresAt ?? -Infinity);
    if (
      !Number.isFinite(time) ||
      !Number.isFinite(ttlSeconds) ||
      ttlSeconds <= 0 ||
      !Number.isFinite(expires)
    )
      throw new RangeError('Invalid replay lifetime');
    const saved = this.entries.get(key);
    if (saved && saved.expires >= time) return false;
    this.sweep(time);
    const scope = context.scope ?? '';
    const count = this.scopes.get(scope) ?? 0;
    if (this.entries.size >= this.capacity || count >= this.perOperatorCapacity) {
      this.exhaustions++;
      throw new Failure('replay_capacity_exhausted', true);
    }
    const entry = { key, scope, expires };
    this.entries.set(key, entry);
    this.scopes.set(scope, count + 1);
    let i = this.heap.length;
    this.heap.push(entry);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[parent].expires <= expires) break;
      this.heap[i] = this.heap[parent];
      i = parent;
    }
    this.heap[i] = entry;
    return true;
  }
  status() {
    return {
      entries: this.entries.size,
      capacity: this.capacity,
      perOperatorCapacity: this.perOperatorCapacity,
      saturation: this.entries.size / this.capacity,
      exhaustions: this.exhaustions,
    };
  }
}
export function isMemoryNonceStore(store: unknown): store is MemoryNonceStore {
  return !!store && (store as MemoryNonceStore)[brand] === true;
}
