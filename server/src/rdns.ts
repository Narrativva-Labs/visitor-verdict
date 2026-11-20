import { Resolver } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Registry, ReverseDnsOptions, DnsResolver } from './types.js';

interface Evidence {
  operator?: string;
  unavailable: boolean;
}
interface Entry {
  scope: string;
  until: number;
  evidence: Evidence;
}
export interface DnsConfig {
  resolver?: DnsResolver;
  timeoutMs: number;
  cacheSize: number;
  ttlSec: number;
}
export const DNS_CONCURRENCY = 4;
export function normalizedIp(value: string): string | undefined {
  const family = isIP(value);
  if (!family || value.includes('%')) return;
  if (family === 4) return value;
  const canonical = new URL('http://[' + value + ']/').hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(canonical);
  if (!mapped) return canonical;
  const hi = parseInt(mapped[1], 16);
  const lo = parseInt(mapped[2], 16);
  return [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');
}
function hostname(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 254) return;
  const name = value.toLowerCase().replace(/\.$/, '');
  if (
    name.length > 253 ||
    !name.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
    return;
  return name;
}
export function matchesSuffix(name: string, suffix: string): boolean {
  return name === suffix || name.endsWith('.' + suffix);
}
export function dnsConfig(input: ReverseDnsOptions | undefined): DnsConfig | undefined {
  if (input === undefined) return;
  if (!input || typeof input.enabled !== 'boolean') throw new TypeError('Invalid reverseDns');
  function bounded(value: number | undefined, fallback: number, max: number) {
    const n = value ?? fallback;
    if (!Number.isSafeInteger(n) || n < 1 || n > max)
      throw new TypeError('Invalid reverseDns limit');
    return n;
  }
  const timeoutMs = bounded(input.timeoutMs, 500, 60000);
  const cacheSize = bounded(input.cacheSize, 1024, 4096);
  const ttlSec = bounded(input.ttlSec, 300, 3600);
  if (
    input.resolver &&
    ['reverse', 'resolve4', 'resolve6'].some(
      (method) => typeof input.resolver![method as keyof DnsResolver] !== 'function',
    )
  )
    throw new TypeError('Invalid DNS resolver');
  if (!input.enabled) return;
  return { resolver: input.resolver, timeoutMs, cacheSize, ttlSec };
}
/** Optional IP-keyed cache exists only for explicit DNS opt-in. Never logs or returns IPs/PTRs. */
export class ReverseDnsVerifier {
  private cache = new Map<string, Entry>();
  private flights = new Map<string, { scope: string; promise: Promise<Evidence> }>();
  private active = 0;
  constructor(
    private config: DnsConfig,
    private registry: Registry,
  ) {}

  async verify(
    ip: string | undefined,
    ua: string[],
    now: number,
    signal: AbortSignal,
  ): Promise<Evidence> {
    if (!ip || signal.aborted) return { unavailable: false };
    const address = normalizedIp(ip);
    if (!address) return { unavailable: false };
    const candidates = this.registry.flatMap((operator) =>
      (operator.reverseDns ?? [])
        .filter(
          (rule) =>
            rule.uaTokens.some((token) => ua.includes(token)) &&
            (!rule.ipv4Only || isIP(address) === 4),
        )
        .map((rule) => ({ operator: operator.operator, rule })),
    );
    if (!candidates.length) return { unavailable: false };
    const scope = candidates
      .map(({ operator, rule }) => operator + ':' + rule.suffixes.join(','))
      .join('|');
    const cached = this.cache.get(address);
    if (cached && cached.scope === scope && now < cached.until) {
      this.cache.delete(address);
      this.cache.set(address, cached);
      return cached.evidence;
    }
    const flight = this.flights.get(address);
    if (flight) return flight.scope === scope ? flight.promise : { unavailable: true };
    if (this.active >= DNS_CONCURRENCY) return { unavailable: true };
    const promise = this.lookup(address, candidates, signal)
      .then((evidence) => {
        this.cache.delete(address);
        this.cache.set(address, { scope, evidence, until: now + this.config.ttlSec });
        while (this.cache.size > this.config.cacheSize)
          this.cache.delete(this.cache.keys().next().value!);
        return evidence;
      })
      .finally(() => this.flights.delete(address));
    this.flights.set(address, { scope, promise });
    return promise;
  }

  private async lookup(
    ip: string,
    candidates: Array<{
      operator: string;
      rule: NonNullable<Registry[number]['reverseDns']>[number];
    }>,
    signal: AbortSignal,
  ): Promise<Evidence> {
    const resolver =
      this.config.resolver ?? new Resolver({ timeout: this.config.timeoutMs, tries: 1 });
    this.active++;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    const work = async (): Promise<Evidence> => {
      let hadError = false;
      const ptrs = await resolver.reverse(ip);
      if (!Array.isArray(ptrs) || ptrs.length > 8) return { unavailable: true };
      for (const ptr of ptrs) {
        if (expired || signal.aborted) return { unavailable: true };
        const name = hostname(ptr);
        if (!name) continue;
        const allowed = candidates.filter((c) =>
          c.rule.suffixes.some((suffix) => matchesSuffix(name, suffix)),
        );
        if (!allowed.length) continue;
        const records = await Promise.allSettled([
          resolver.resolve4(name),
          resolver.resolve6(name),
        ]);
        if (expired || signal.aborted) return { unavailable: true };
        for (const record of records) {
          if (record.status === 'rejected') {
            const code = (record.reason as { code?: string })?.code;
            if (code !== 'ENODATA' && code !== 'ENOTFOUND') hadError = true;
          } else if (!Array.isArray(record.value) || record.value.length > 32) hadError = true;
          else if (
            record.value.some(
              (value) =>
                typeof value === 'string' && value.length <= 64 && normalizedIp(value) === ip,
            )
          )
            return { operator: allowed[0].operator, unavailable: false };
        }
      }
      return { unavailable: hadError };
    };
    // Retain the concurrency slot until actual work settles, even if an injected resolver ignores cancel.
    const pending = work()
      .catch(() => ({ unavailable: true }))
      .finally(() => {
        this.active--;
      });
    try {
      return await Promise.race([
        pending,
        new Promise<Evidence>((resolve) => {
          timer = setTimeout(() => {
            expired = true;
            try {
              resolver.cancel?.();
            } catch {
              /* Cancellation is best effort for injected resolvers. */
            }
            resolve({ unavailable: true });
          }, this.config.timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
