import { Failure, failure } from './errors.js';
import type { Fetcher } from './types.js';

export type DocumentKind = 'directory' | 'ip';
interface Entry {
  data?: unknown;
  until: number;
  cooldown: number;
  flight?: Promise<unknown>;
}
/** Verification retention is deliberately separate from browser/shared HTTP caching. */
export function ttlFromHeaders(headers: Pick<Headers, 'get'>): number {
  const cc = headers.get('cache-control') ?? '';
  const age = Math.max(0, Number(headers.get('age')) || 0);
  const maxAge = /(?:^|,)\s*max-age="?(\d+)"?/i.exec(cc)?.[1];
  const ttl = /(?:^|,)\s*(?:no-store|no-cache)(?:\s|,|=|$)/i.test(cc)
    ? 0
    : Number(maxAge ?? 300) - age;
  return Math.max(300, Math.min(86400, ttl));
}
function cancelBody(response: Response | undefined): void {
  if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {});
}
export async function fetchBounded(
  url: string,
  fetcher: Fetcher,
  kind: DocumentKind,
  timeoutMs: number,
): Promise<{ data: unknown; ttl: number }> {
  const controller = new AbortController();
  const limit = kind === 'directory' ? 65536 : 1048576;
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      if (reader) void reader.cancel().catch(() => {});
      cancelBody(response);
      reject(new Failure('directory_timeout', true));
    }, timeoutMs);
  });
  async function work() {
    response = await fetcher(url, {
      redirect: 'manual',
      signal: controller.signal,
      credentials: 'omit',
    });
    if (controller.signal.aborted) {
      cancelBody(response);
      throw new Failure('directory_timeout', true);
    }
    if (response.status !== 200 || response.redirected || (response.url && response.url !== url))
      throw new Failure('directory_http_error', true);
    if (Number(response.headers.get('content-length')) > limit)
      throw new Failure('directory_too_large', true);
    if (!response.body) throw new Failure('directory_unavailable', true);
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const part = await reader.read();
      if (controller.signal.aborted) throw new Failure('directory_timeout', true);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) throw new Failure('directory_too_large', true);
      chunks.push(part.value);
    }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return { data, ttl: ttlFromHeaders(response.headers) };
  }
  try {
    return await Promise.race([work(), timeout]);
  } catch (error) {
    controller.abort();
    if (error instanceof Failure) throw error;
    throw new Failure('directory_unavailable', true);
  } finally {
    clearTimeout(timer);
    if (reader) void reader.cancel().catch(() => {});
    cancelBody(response);
  }
}
export class AgentCache {
  private entries = new Map<string, Entry>();
  constructor(
    private fetcher: Fetcher,
    private timeoutMs: number,
  ) {}

  async load<T>(
    url: string,
    kind: DocumentKind,
    now: number,
    decode: (data: unknown) => T,
    force = false,
  ): Promise<T> {
    const cacheKey = kind + ':' + url;
    let entry = this.entries.get(cacheKey);
    if (!entry) {
      entry = { until: 0, cooldown: 0 };
      this.entries.set(cacheKey, entry);
    }
    if (entry.flight) return entry.flight as Promise<T>;
    if (!force && entry.data !== undefined && now < entry.until) return entry.data as T;
    if (now < entry.cooldown) {
      if (entry.data !== undefined && now < entry.until) return entry.data as T;
      throw new Failure('directory_unavailable', true);
    }
    if (force) entry.cooldown = now + 60;
    entry.flight = this.refresh(url, kind, now, entry, decode);
    return entry.flight as Promise<T>;
  }

  private async refresh<T>(
    url: string,
    kind: DocumentKind,
    now: number,
    entry: Entry,
    decode: (data: unknown) => T,
  ): Promise<T> {
    try {
      const response = await fetchBounded(url, this.fetcher, kind, this.timeoutMs);
      const data = decode(response.data);
      entry.data = data;
      entry.until = now + response.ttl;
      return data;
    } catch (error) {
      entry.cooldown = now + 60;
      throw failure(error);
    } finally {
      entry.flight = undefined;
    }
  }
}
