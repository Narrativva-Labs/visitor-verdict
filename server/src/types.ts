import type { IncomingHttpHeaders } from 'node:http';

/** Supported transport header containers. Arrays are Node rawHeaders (alternating names/values). */
export type HeadersInput =
  | IncomingHttpHeaders
  | Headers
  | ReadonlyMap<string, string | readonly string[]>
  | readonly string[];
/** Original request context supplied by a trusted transport adapter. */
export interface AgentRequest {
  method: string;
  host: string;
  headers: HeadersInput;
  clientIp?: string;
  /** Raw origin-form target or absolute HTTPS URI; never pre-normalize dot segments or escapes. */
  target?: string;
}
/** An operator whose exact endpoints are trusted by application configuration. */
export interface Operator {
  operator: string;
  signatureAgent?: string;
  directoryUrl?: string;
  /** Operator-specific compatibility for non-thumbprint keyid values; default false. */
  allowKidAlias?: boolean;
  verifiedByCapture: boolean;
  source: string;
  checked: string;
  ipLists: readonly IpList[];
  /** Additional server-only UA tokens; browser defaults remain unchanged. */
  extraUaTokens?: readonly string[];
  /** Static operator-published ranges, gated by extraUaTokens. */
  staticPrefixes?: readonly string[];
  /** Primary-source-confirmed suffix rules; never inferred from a request. */
  reverseDns?: readonly ReverseDnsRule[];
}
/** An operator-published IP feed, optionally restricted to known claims. */
export interface IpList {
  name: string;
  url: string;
  uaTokens?: readonly string[];
  /** SAIL is a schema-specific TOML feed; other feeds are JSON. */
  format?: 'json' | 'sail';
  /** Required SAIL service name whose ranges provide evidence. */
  service?: string;
}
/** Registry is trusted configuration, never request-controlled. */
export type Registry = readonly Operator[];
/** Caller-owned atomic replay store. Enabling it opts into nonce retention outside this library. */
export interface NonceStore {
  insertIfAbsent(key: string, ttlSeconds: number): Promise<boolean>;
}
/** HTTPS transport injection; must honor manual redirects and TLS validation. */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
/** Verification evidence. No client IP, raw headers, signature bytes or nonce are returned. */
export interface AgentVerdict {
  claimed: { uaTokens: string[]; signatureAgents: string[] };
  verification: 'signature_valid' | 'signature_invalid' | 'no_signature' | 'ip_match' | 'none';
  reason: string;
  verified?: {
    operator: string;
    method: 'signature' | 'ip' | 'rdns';
    signatureAgent?: string;
    keyid?: string;
    keyidForm?: 'thumbprint' | 'kid';
    /** Dictionary identity selected by current label or by its sole covered member after relabeling. */
    attribution?: 'label' | 'relabeled';
  };
  signatures: SignatureResult[];
  ip?: { operator: string; list: string };
  rdns?: { operator: string };
}
/** Per-label result retained even when another valid signature wins. */
export interface SignatureResult {
  label: string;
  result: 'signature_valid' | 'signature_invalid' | 'none';
  reason: string;
  /** Successful dictionary attribution; absent for legacy bare-string identities. */
  attribution?: 'label' | 'relabeled';
}
/** Construction-time configuration. Clock values are Unix seconds. */
export interface VerifierOptions {
  registry: Registry;
  authorities: readonly string[];
  fetcher?: Fetcher;
  deadlineMs?: number;
  /** Maximum expires-created lifetime; default 86400 seconds, longer lifetimes are indeterminate. */
  maxLifetimeSeconds?: number;
  fetchTimeoutMs?: number;
  nonceStore?: NonceStore;
  now?: () => number;
  /** Explicit opt-in: PTR queries disclose bot-claiming clients’ IPs to the resolver. */
  reverseDns?: ReverseDnsOptions;
}
/** Reusable verifier with a private cache, bounded by the configured registry. */
export interface AgentVerifier {
  verify(input: AgentRequest): Promise<AgentVerdict>;
}

/** Injectable DNS transport, compatible with node:dns/promises Resolver. */
export interface DnsResolver {
  reverse(ip: string): Promise<string[]>;
  resolve4(host: string): Promise<string[]>;
  resolve6(host: string): Promise<string[]>;
  cancel?(): void;
}
/** Optional network verification and bounded, memory-only per-IP retention. Disabled by default. */
export interface ReverseDnsOptions {
  enabled: boolean;
  resolver?: DnsResolver;
  timeoutMs?: number;
  cacheSize?: number;
  ttlSec?: number;
}
/** Primary-source-confirmed DNS names, scoped to the relevant UA tokens. */
export interface ReverseDnsRule {
  uaTokens: readonly string[];
  suffixes: readonly string[];
  source: string;
  checked: string;
  ipv4Only?: boolean;
}
