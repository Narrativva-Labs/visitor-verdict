import { createHash } from 'node:crypto';
import { prefixPolicy, type ShrinkCandidate } from './prefix-policy.js';
import { parseSail } from './sail.js';
import { Failure, failure } from './errors.js';
import type { Fetcher, RefreshEvent, VerifierStatus } from './types.js';

export type DocumentKind = 'directory' | 'ip' | 'sail';
interface LogicalState {
  at?: number;
  ok: boolean;
  staleUntil: number;
  candidate?: ShrinkCandidate;
}
interface Entry {
  candidate?: ShrinkCandidate;
  services?: Map<string, LogicalState>;
  data?: unknown;
  /** Fetch time, soft expiry (serve as fresh) and hard expiry (serve while revalidating). */
  fetched: number;
  /** Completion time of the last validated HTTPS refresh; never advanced by cache reads/failures. */
  lastSuccessfulRefreshAt?: number;
  lastRefreshOk?: boolean;
  until: number;
  staleUntil: number;
  cooldown: number;
  flight?: Promise<unknown>;
  forcedFlight?: Promise<unknown>;
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
  const limit = kind === 'ip' ? 1048576 : 65536;
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
    const text = Buffer.concat(chunks).toString('utf8');
    if (kind === 'sail') {
      if (response.headers.get('content-type')?.split(';')[0].trim() !== 'application/sail+toml')
        throw new Failure('invalid_sail', true);
      const data = parseSail(text);
      return { data, ttl: Math.max(300, Math.min(86400, data.expiresAfter)) };
    }
    const data: unknown = JSON.parse(text);
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
export const FEED_CACHE_SIZE = 32;
export const DIRECTORY_CACHE_SIZE = 128;
/** Cached modes never join a fetch; a miss starts a background refresh and returns cache_miss. */
export type LoadMode =
  | 'request'
  | 'forced'
  | 'warm'
  | 'ahead'
  | 'cached'
  | 'cached-forced'
  | 'mismatch'
  | 'claim';
export interface CacheOptions {
  /** Hard maximum age of retained data since its fetch; 0 disables stale serving. */
  staleMaxSeconds?: number;
  /** Clock in Unix seconds for refresh-ahead timers. */
  now?: () => number;
  onRefresh?: (event: RefreshEvent) => void;
}
interface AheadJob {
  url: string;
  kind: DocumentKind;
  decode: (data: unknown) => unknown;
  timer?: ReturnType<typeof setTimeout>;
}
const COOLDOWN_SECONDS = 60;
/** Refresh-ahead lead before soft expiry: a tenth of the TTL, between 1 and 60 seconds. */
function lead(entry: Entry): number {
  return Math.max(1, Math.min(60, Math.floor((entry.until - entry.fetched) / 10)));
}
export class AgentCache {
  private entries = new Map<string, Entry>();
  private completeIp = new Set<string>();
  private completeSail = new Map<string, Set<string>>();
  private ahead = new Map<string, AheadJob>();
  private closed = false;
  private staleMaxSeconds: number;
  private now: () => number;
  private lastRefreshOk: boolean | null = null;
  private lastRefreshAt: number | null = null;
  private onRefresh?: (event: RefreshEvent) => void;
  constructor(
    private fetcher: Fetcher,
    private timeoutMs: number,
    options: CacheOptions = {},
  ) {
    this.staleMaxSeconds = options.staleMaxSeconds ?? 0;
    this.now = options.now ?? (() => Date.now() / 1000);
    this.onRefresh = options.onRefresh;
  }

  status(targets: readonly (readonly [string, DocumentKind])[]): VerifierStatus {
    const now = this.clock();
    const directories = { loaded: 0, total: 0 };
    const ipLists = { loaded: 0, total: 0 };
    for (const [url, kind] of targets) {
      const count = kind === 'directory' ? directories : ipLists;
      count.total++;
      const entry = this.entries.get(kind + ':' + url);
      if (entry?.data !== undefined && now < entry.staleUntil) count.loaded++;
    }
    return {
      directories,
      ipLists,
      lastRefreshOk: this.lastRefreshOk,
      lastRefreshAt: this.lastRefreshAt,
    };
  }

  successfulRefreshAt(url: string, kind: DocumentKind): number | undefined {
    return this.entries.get(kind + ':' + url)?.lastSuccessfulRefreshAt;
  }

  /** SAIL download is single-flight; evidence and LKG age are per logical service. */
  serviceStatus(url: string, service: string, now: number) {
    const state = this.entries.get('sail:' + url)?.services?.get(service);
    return { at: state?.at, ok: state?.ok === true, available: !!state && now < state.staleUntil };
  }

  /** Trusted registry policy: completeness guards apply only to configured complete lists. */
  requireComplete(url: string, service?: string): void {
    if (service === undefined) this.completeIp.add(url);
    else {
      const services = this.completeSail.get(url) ?? new Set<string>();
      services.add(service);
      this.completeSail.set(url, services);
    }
  }

  private refreshed(
    kind: DocumentKind,
    ok: boolean,
    now: number,
    hostname: string,
    reason?: string,
  ): void {
    const clock = this.clock();
    const at = Number.isFinite(clock) ? clock : now;
    this.lastRefreshOk = ok;
    this.lastRefreshAt = at;
    try {
      this.onRefresh?.({ kind, ok, at, hostname, ...(reason ? { reason } : {}) });
    } catch {
      // Diagnostics cannot change a document's validity or the verification result.
    }
  }

  private touch(cacheKey: string, kind: DocumentKind): Entry {
    let entry = this.entries.get(cacheKey);
    if (!entry) {
      const directory = kind === 'directory';
      const keys = [...this.entries.keys()].filter(
        (key) => key.startsWith('directory:') === directory,
      );
      const limit = directory ? DIRECTORY_CACHE_SIZE : FEED_CACHE_SIZE;
      if (keys.length >= limit) {
        const victim = keys.find((key) => {
          const value = this.entries.get(key)!;
          return !value.flight && !value.forcedFlight;
        });
        if (!victim) throw new Failure('feed_cache_busy', true);
        this.entries.delete(victim);
      }
      entry = { until: 0, staleUntil: 0, fetched: 0, cooldown: 0 };
    }
    this.entries.delete(cacheKey);
    this.entries.set(cacheKey, entry);
    return entry;
  }

  /** trace records only a successfully awaited fetch, never a cached/cooldown fallback. */
  async load<T>(
    url: string,
    kind: DocumentKind,
    now: number,
    decode: (data: unknown) => T,
    mode: LoadMode = 'request',
    trace?: { fetched: boolean; successfulRefreshAt?: number; refreshOk?: boolean },
  ): Promise<T> {
    const cacheKey = kind + ':' + url;
    const entry = this.touch(cacheKey, kind);
    const force = mode === 'forced' || mode === 'cached-forced' || mode === 'mismatch';
    const cacheOnly = mode === 'cached' || mode === 'cached-forced' || mode === 'claim';
    const request = mode === 'request' || mode === 'cached';
    const usable = entry.data !== undefined && now < entry.staleUntil;
    if (mode === 'claim' && usable) {
      if (trace) trace.successfulRefreshAt = entry.lastSuccessfulRefreshAt;
      if (trace) trace.refreshOk = entry.lastRefreshOk === true;
      if (
        (entry.lastSuccessfulRefreshAt === undefined ||
          !Number.isFinite(entry.lastSuccessfulRefreshAt) ||
          now + 60 < entry.lastSuccessfulRefreshAt ||
          now - entry.lastSuccessfulRefreshAt >= 600) &&
        !entry.flight &&
        !entry.forcedFlight &&
        now >= entry.cooldown
      ) {
        entry.cooldown = now + COOLDOWN_SECONDS;
        entry.flight = this.refresh(url, kind, now, entry, decode, 'flight');
        entry.flight.catch(() => {});
      }
      return entry.data as T;
    }
    if ((request || mode === 'warm') && usable && now < entry.until) return entry.data as T;
    const pending = force
      ? (entry.forcedFlight ?? entry.flight)
      : (entry.flight ?? entry.forcedFlight);
    if (request && usable) {
      // Stale-while-revalidate: serve the last valid document while one refresh runs.
      if (!pending && now >= entry.cooldown) {
        entry.flight = this.refresh(url, kind, now, entry, decode, 'flight');
        entry.flight.catch(() => {});
      }
      return entry.data as T;
    }
    if (pending) {
      if (cacheOnly) throw new Failure('cache_miss', true);
      const data = (await pending) as T;
      if (trace) trace.fetched = true;
      return data;
    }
    if (now < entry.cooldown) {
      if (mode === 'mismatch') throw new Failure('directory_unavailable', true);
      if (usable && now < entry.until) return entry.data as T;
      throw new Failure(cacheOnly ? 'cache_miss' : 'directory_unavailable', true);
    }
    if (force) entry.cooldown = now + COOLDOWN_SECONDS;
    const slot = force ? 'forcedFlight' : 'flight';
    entry[slot] = this.refresh(url, kind, now, entry, decode, slot);
    if (cacheOnly) {
      entry[slot].catch(() => {});
      throw new Failure('cache_miss', true);
    }
    const data = (await entry[slot]) as T;
    if (trace) trace.fetched = true;
    return data;
  }

  /** Keep an entry warm: refresh shortly before soft expiry, retrying after failures. */
  keepWarm(url: string, kind: DocumentKind, decode: (data: unknown) => unknown): void {
    const cacheKey = kind + ':' + url;
    if (this.closed || this.ahead.has(cacheKey)) return;
    this.ahead.set(cacheKey, { url, kind, decode });
    this.schedule(cacheKey);
  }

  /** Stop refresh-ahead timers. In-flight fetches end on their own timeout; loads keep working. */
  close(): void {
    this.closed = true;
    for (const job of this.ahead.values()) clearTimeout(job.timer);
    this.ahead.clear();
  }

  private clock(): number {
    try {
      const now = this.now();
      return Number.isFinite(now) && now <= 1e11 ? now : NaN;
    } catch {
      return NaN;
    }
  }

  private due(entry: Entry | undefined): number | undefined {
    return entry?.data === undefined ? undefined : entry.until - lead(entry);
  }

  private schedule(cacheKey: string): void {
    const job = this.ahead.get(cacheKey);
    if (!job || this.closed) return;
    clearTimeout(job.timer);
    const entry = this.entries.get(cacheKey);
    const now = this.clock();
    const at = entry ? Math.max(this.due(entry) ?? 0, entry.cooldown) : 0;
    const delay = Number.isFinite(now) && at > 0 ? at - now : COOLDOWN_SECONDS;
    job.timer = setTimeout(() => this.fire(cacheKey), Math.min(86400, Math.max(1, delay)) * 1000);
    job.timer.unref?.();
  }

  private fire(cacheKey: string): void {
    const job = this.ahead.get(cacheKey);
    if (!job || this.closed) return;
    job.timer = undefined;
    const now = this.clock();
    const due = this.due(this.entries.get(cacheKey));
    // Another load may already have refreshed the entry; then only reschedule.
    if (!Number.isFinite(now) || (due !== undefined && now < due)) return this.schedule(cacheKey);
    this.load(job.url, job.kind, now, job.decode, 'ahead')
      .catch(() => {})
      .finally(() => this.schedule(cacheKey));
  }

  private async refresh<T>(
    url: string,
    kind: DocumentKind,
    now: number,
    entry: Entry,
    decode: (data: unknown) => T,
    slot: 'flight' | 'forcedFlight',
  ): Promise<T> {
    try {
      const response = await fetchBounded(url, this.fetcher, kind, this.timeoutMs);
      let data = decode(response.data);
      const completed = this.clock();
      const at = Number.isFinite(completed) ? completed : now;
      const expiry = now + (this.staleMaxSeconds > 0 ? this.staleMaxSeconds : response.ttl);
      const guard = (next: any, previous: any, candidate?: ShrinkCandidate) =>
        prefixPolicy(
          next?.prefixCount ?? 0,
          previous?.prefixCount,
          createHash('sha256')
            .update(
              JSON.stringify([
                [...(next?.rules ?? [])].sort(),
                [...(next?.shared?.rules ?? [])].sort(),
              ]),
            )
            .digest('hex'),
          at,
          candidate,
        );
      if (kind === 'ip' && this.completeIp.has(url)) {
        const decision = guard(data, entry.data, entry.candidate);
        entry.candidate = decision.candidate;
        if (!decision.accept) throw new Failure('shrink', true);
      }
      let partial = false;
      if (kind === 'sail') {
        const next = data as Map<string, unknown>;
        const previous = entry.data as Map<string, unknown> | undefined;
        const states = entry.services ?? new Map<string, LogicalState>();
        const merged = new Map(next);
        const names = new Set([
          ...next.keys(),
          ...(previous?.keys() ?? []),
          ...(this.completeSail.get(url) ?? []),
        ]);
        for (const name of names) {
          const prior = states.get(name);
          const complete = this.completeSail.get(url)?.has(name);
          const decision = complete
            ? guard(next.get(name), previous?.get(name), prior?.candidate)
            : { accept: next.has(name) };
          if (decision.accept)
            states.set(name, {
              at: Number.isFinite(completed) ? completed : undefined,
              ok: true,
              staleUntil: expiry,
            });
          else {
            partial = true;
            states.set(name, {
              at: prior?.at,
              ok: false,
              staleUntil: prior?.staleUntil ?? 0,
              candidate: decision.candidate,
            });
            if (previous?.has(name) && now < (prior?.staleUntil ?? 0))
              merged.set(name, previous.get(name));
            else merged.delete(name);
          }
        }
        entry.services = states;
        data = merged as T;
      }
      // A newer document replaces the previous one entirely; removed keys stop verifying.
      const completedAt = this.clock();
      entry.lastSuccessfulRefreshAt = Number.isFinite(completedAt) ? completedAt : undefined;
      entry.lastRefreshOk = !partial;
      entry.data = data;
      entry.fetched = now;
      const ttl =
        this.staleMaxSeconds > 0 ? Math.min(response.ttl, this.staleMaxSeconds) : response.ttl;
      entry.until = now + ttl;
      entry.staleUntil = this.staleMaxSeconds > 0 ? now + this.staleMaxSeconds : entry.until;
      this.refreshed(kind, !partial, now, new URL(url).hostname, partial ? 'shrink' : undefined);
      return data;
    } catch (error) {
      entry.lastRefreshOk = false;
      for (const state of entry.services?.values() ?? []) state.ok = false;
      entry.cooldown = now + COOLDOWN_SECONDS;
      const f = failure(error);
      this.refreshed(kind, false, now, new URL(url).hostname, f.reason);
      throw f;
    } finally {
      entry[slot] = undefined;
      this.schedule(kind + ':' + url);
    }
  }
}
