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
  /** Adapter-established client IP; defaults to true for direct connections. */
  ipTrusted?: boolean;
  /** External transport security from a trusted adapter; false makes WBA context insufficient. */
  secure?: boolean;
  /** Disable weak diagnostics behind stripping proxies or privacy/enterprise policies. */
  headerDiagnostics?: boolean;
  /** Raw origin-form target or absolute HTTPS URI; never pre-normalize dot segments or escapes. */
  target?: string;
}
/** An operator whose exact endpoints are trusted by application configuration. */
export interface Operator {
  operator: string;
  poppyClientId?: string;
  poppyJwksUri?: string;
  signatureAgent?: string;
  directoryUrl?: string;
  /** Operator-specific compatibility for non-thumbprint keyid values; default false. */
  allowKidAlias?: boolean;
  /**
   * Signing infrastructure that signs on behalf of other parties' agents (Cloudflare's
   * "intermediary", as opposed to "direct"). A valid signature identifies the
   * infrastructure, never the agent; its purpose is `intermediary`. Default false.
   */
  intermediary?: boolean;
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
  /** Documented product purpose, applied only after operator verification. */
  purposes?: PurposePolicy;
  /** Provenance of individual registry claims; descriptive, never a verification bypass. */
  evidence?: readonly RegistryEvidence[];
}
/** Documented operator facts, observed wire behavior, or explicitly inferred mappings. */
export interface RegistryEvidence {
  level: 'documented' | 'observed' | 'inferred';
  source: string;
  checked: string;
  note: string;
  /** Omit for evidence applying to the entry as a whole. */
  uaTokens?: readonly string[];
}
/**
 * Operator-declared product role; never a finding about a person's intent or authorization.
 * `intermediary` (since 0.4.0): the verified signer is infrastructure signing for another
 * party's agent; the agent itself is not identified.
 */
export type AgentPurpose = 'user_directed' | 'crawler' | 'intermediary' | 'unknown';
/** Exact registry evidence names and known UA tokens, with primary-source provenance. */
export interface PurposePolicy {
  signatureAgent?: Exclude<AgentPurpose, 'intermediary'>;
  ipLists?: Readonly<Record<string, Exclude<AgentPurpose, 'intermediary'>>>;
  uaTokens?: Readonly<Record<string, Exclude<AgentPurpose, 'intermediary'>>>;
  sources: readonly string[];
  checked: string;
}
/** An operator-published IP feed, optionally restricted to known claims. */
export interface IpList {
  name: string;
  url: string;
  /** Published as complete for these UA tokens; never inferred from a positive match. */
  complete?: boolean;
  source?: string;
  checked?: string;
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
  /** Weak local diagnostics; never identity or verification evidence. */
  evidence?: readonly ('header_mismatch' | 'shared_ip_range')[];
  agent_purpose: AgentPurpose;
  claimed: { uaTokens: string[]; signatureAgents: string[]; poppySession?: boolean };
  poppy?: import('./poppy.js').PoppyResult;
  verification:
    | 'signature_valid'
    | 'signature_invalid'
    | 'no_signature'
    | 'ip_match'
    | 'ip_mismatch'
    | 'none';
  reason: string;
  /** Trust in the transport IP used for negative range evidence. */
  ipTrusted?: boolean;
  /** Every operator IP feed has a known successful source refresh within two hours. */
  ipListsFresh?: boolean;
  verified?: {
    operator: string;
    method: 'signature' | 'ip' | 'rdns' | 'poppy';
    /** Signed proof expiry in Unix seconds, without verification clock skew. */
    expiresAt?: number;
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
  /** Opt into negative evidence from complete operator IP lists; default false. */
  flagSpoofedClaims?: boolean;
  /** Poppy replay defaults to one local verifier; inject shared atomic storage for replicas. */
  poppy?: { enabled: boolean; replayStore?: NonceStore };
  registry: Registry;
  authorities: readonly string[];
  fetcher?: Fetcher;
  deadlineMs?: number;
  /** Maximum expires-created lifetime; default 86400 seconds, longer lifetimes are indeterminate. */
  maxLifetimeSeconds?: number;
  fetchTimeoutMs?: number;
  /**
   * Hard maximum age of a fetched directory/feed, default 86400 seconds; 0 disables stale serving.
   * After the soft TTL the last valid document is served while one background refresh runs.
   */
  staleMaxSeconds?: number;
  nonceStore?: NonceStore;
  now?: () => number;
  /** Explicit opt-in: PTR queries disclose bot-claiming clients’ IPs to the resolver. */
  reverseDns?: ReverseDnsOptions;
  /** Optional operational callback. Contains public cache metadata only; callback errors are ignored. */
  onRefresh?: (event: RefreshEvent) => void;
}
/** Reusable verifier with a private cache, bounded by the configured registry. */
export interface AgentVerifier {
  verify(input: AgentRequest, options?: VerifyOptions): Promise<AgentVerdict>;
  /** Prefetch registry directories (and optionally feeds). Never rejects; safe to repeat. */
  warm(options?: WarmOptions): Promise<WarmResult>;
  /** Stop refresh-ahead timers. verify() and warm() keep working without timers. */
  close(): void;
  /** Counts usable documents and the most recently completed refresh; never fetches or exposes visitors. */
  status(): VerifierStatus;
}
/** Aggregate in-memory cache health. Times are Unix seconds; null means no refresh has completed. */
export interface VerifierStatus {
  directories: { loaded: number; total: number };
  ipLists: { loaded: number; total: number };
  lastRefreshOk: boolean | null;
  lastRefreshAt: number | null;
}
/** A completed public-document refresh; no URL, IP, request headers, key or nonce. */
export interface RefreshEvent {
  /** Public endpoint hostname only; never a URL, path or visitor data. */
  hostname?: string;
  kind: 'directory' | 'ip' | 'sail';
  ok: boolean;
  at: number;
  reason?: string;
}
/** Per-request behavior; configuration and network targets remain construction-time options. */
export interface VerifyOptions {
  /**
   * Use only trusted cached documents and static ranges. Misses refresh in the background and
   * return none/cache_miss without waiting. DNS and external replay-store calls are not made. MemoryNonceStore is supported.
   */
  cacheOnly?: boolean;
}
export interface WarmOptions {
  /** Also prefetch every JSON IP list and SAIL feed in the registry. */
  ipLists?: boolean;
  /** Refresh warmed entries shortly before soft expiry using unref'd timers until close(). */
  refreshAhead?: boolean;
}
/** Endpoint URLs whose prefetch succeeded or failed. */
export interface WarmResult {
  ok: string[];
  failed: string[];
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
