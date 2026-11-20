import { guard } from './lexer.js';
import { createClaimParser } from './claims.js';
import { requiredHeaderNames as collectRequiredHeaderNames } from './fields.js';
import { AgentCache, type DocumentKind } from './cache.js';
import { validateConfig } from './config.js';
import { assertHeadersInput, headers, field } from './headers.js';
import { dictionary, coveredHeaderNames as collectCoveredHeaderNames } from './fields.js';
import { Failure, failure } from './errors.js';
import { checkContext, selectOutcome } from './policy.js';
import { evaluateSignature } from './signature.js';
import { ReverseDnsVerifier } from './rdns.js';
import { staticBlocks, ipEvidence, decodeList, decodeSail } from './ip.js';
import { publicKeys } from './keys.js';
import { purposeFor, type DnsPurposeEvidence } from './purpose.js';
import type {
  AgentRequest,
  AgentVerdict,
  AgentVerifier,
  VerifierOptions,
  VerifyOptions,
  WarmOptions,
  WarmResult,
} from './types.js';
export type * from './types.js';
export { defaultRegistry } from './registry.js';

/** Collect covered field names for adapters without exposing internal SF parser types. */
export function coveredHeaderNames(signatureInput: string): string[] {
  return collectCoveredHeaderNames(signatureInput);
}

/** Collector headers: never throws, including absent/malformed Signature-Input. */
export function requiredHeaderNames(signatureInput?: string): string[] {
  return collectRequiredHeaderNames(signatureInput);
}

function emptyVerdict(): AgentVerdict {
  return {
    agent_purpose: 'unknown',
    claimed: { uaTokens: [], signatureAgents: [] },
    verification: 'none',
    reason: 'internal_error',
    signatures: [],
  };
}
/** Validate trusted configuration once and create a verifier with an owned cache. */
export function createVerifier(options: VerifierOptions): AgentVerifier {
  const config = validateConfig(options);
  const cache = new AgentCache(config.fetcher, config.fetchTimeoutMs, {
    staleMaxSeconds: config.staleMaxSeconds,
    now: config.now,
    onRefresh: config.onRefresh,
  });
  const parseClaims = createClaimParser(config.registry);
  const staticRanges = staticBlocks(config.registry);
  const rdns = config.reverseDns
    ? new ReverseDnsVerifier(config.reverseDns, config.registry)
    : undefined;
  const targets = new Map<string, [string, DocumentKind, (data: unknown) => unknown]>();
  for (const operator of config.registry) {
    if (operator.directoryUrl)
      targets.set('directory:' + operator.directoryUrl, [
        operator.directoryUrl,
        'directory',
        publicKeys,
      ]);
    for (const list of operator.ipLists) {
      const kind = list.format === 'sail' ? 'sail' : 'ip';
      targets.set(kind + ':' + list.url, [
        list.url,
        kind,
        kind === 'sail' ? decodeSail : decodeList,
      ]);
    }
  }

  async function run(
    input: AgentRequest,
    verdict: AgentVerdict,
    signal: AbortSignal,
    cacheOnly: boolean,
  ): Promise<AgentVerdict> {
    let presented = false;
    let dnsPurpose: DnsPurposeEvidence | undefined;
    try {
      const h = headers(input.headers);
      presented = h.has('signature') || h.has('signature-input');
      const context = checkContext(input, config.authorities);
      const now = config.now();
      if (!Number.isFinite(now) || now > 1e11) throw new Failure('invalid_clock', true);
      const claims = parseClaims(h);
      verdict.claimed = { uaTokens: claims.uaTokens, signatureAgents: claims.agent.values };
      const identities = claims.agent.legacy
        ? [claims.agent.legacy]
        : [...claims.agent.identities.values()];
      const trusted = identities.some((identity) =>
        config.registry.some((o) => o.signatureAgent === identity),
      );
      if (claims.agent.values.length && !trusted && !presented)
        throw new Failure('untrusted_signature_agent', true);
      if (presented) {
        if (!field(h, 'signature') || !field(h, 'signature-input'))
          throw new Failure('incomplete_signature_headers');
        const rawInput = field(h, 'signature-input');
        const invalidTimestamps = guard(rawInput, 'signature-input');
        const inputs = dictionary(rawInput, 'signature-input');
        const sigs = dictionary(field(h, 'signature'), 'signature');
        const labels = [...new Set([...inputs.keys(), ...sigs.keys()])];
        if (labels.length > 4) throw new Failure('too_many_signatures');
        for (const member of inputs.values())
          if (Array.isArray(member[0]) && member[0].length > 32)
            throw new Failure('too_many_components');
        for (const label of labels) {
          const evaluation = await evaluateSignature(label, inputs, sigs, {
            context,
            headers: h,
            agent: claims.agent,
            registry: config.registry,
            cache,
            now,
            signal,
            nonceStore: config.nonceStore,
            nonceTimeoutMs: config.fetchTimeoutMs,
            invalidTimestamps,
            maxLifetimeSeconds: config.maxLifetimeSeconds,
            cacheOnly,
          });
          if (signal.aborted) throw new Failure('deadline_exceeded', true);
          verdict.signatures.push(evaluation.result);
          verdict.verified ??= evaluation.verified;
        }
      }
      if (signal.aborted) throw new Failure('deadline_exceeded', true);
      let ipUnavailable = false;
      let ipCacheMiss = false;
      let dnsUnavailable = false;
      let dnsNotConfirmed = false;
      const onlyIgnored =
        verdict.signatures.length > 0 &&
        verdict.signatures.every((s) => s.reason === 'ignored_non_wba');
      if (!claims.agent.values.length || trusted || onlyIgnored) {
        const evidence = await ipEvidence(
          input.clientIp,
          claims.uaTokens,
          config.registry,
          cache,
          now,
          staticRanges,
          cacheOnly,
        );
        verdict.ip = evidence.ip;
        ipUnavailable = evidence.unavailable;
        ipCacheMiss = evidence.cacheMiss === true;
        if (!verdict.ip && !verdict.verified && rdns && !cacheOnly) {
          const dns = await rdns.verify(input.clientIp, claims.uaTokens, now, signal);
          if (dns.operator) {
            verdict.rdns = { operator: dns.operator };
            dnsPurpose = dns.matched;
          } else if (dns.unavailable && !ipUnavailable) dnsUnavailable = true;
          else if (dns.notConfirmed) dnsNotConfirmed = true;
        }
      }
      if (signal.aborted) throw new Failure('deadline_exceeded', true);
      Object.assign(
        verdict,
        selectOutcome(
          verdict.signatures,
          presented,
          verdict.ip ??
            (verdict.rdns ? { operator: verdict.rdns.operator, list: 'rdns' } : undefined),
          ipUnavailable,
        ),
      );
      if (verdict.reason === 'ip_evidence_unavailable' && ipCacheMiss)
        verdict.reason = 'cache_miss';
      if (verdict.verification === 'ip_match') {
        if (verdict.ip) verdict.verified = { operator: verdict.ip.operator, method: 'ip' };
        else {
          verdict.reason = 'reverse_dns_match';
          verdict.verified = { operator: verdict.rdns!.operator, method: 'rdns' };
        }
      } else if (verdict.verification === 'no_signature' && dnsUnavailable) {
        verdict.verification = 'none';
        verdict.reason = 'reverse_dns_unavailable';
      } else if (verdict.verification === 'no_signature' && dnsNotConfirmed) {
        verdict.reason = 'reverse_dns_not_confirmed';
      }
    } catch (error) {
      const f = failure(error);
      verdict.verification = presented && !f.indeterminate ? 'signature_invalid' : 'none';
      verdict.reason = f.reason;
      verdict.verified = undefined;
    }
    verdict.agent_purpose = purposeFor(verdict, config.registry, dnsPurpose);
    return verdict;
  }

  return {
    async verify(input: AgentRequest, options?: VerifyOptions): Promise<AgentVerdict> {
      // Unsupported container types are integration/programmer errors, not visitor verdicts.
      assertHeadersInput(input?.headers);
      const started = performance.now();
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const verdict = emptyVerdict();
      try {
        const deadline = new Promise<AgentVerdict>((resolve) => {
          timer = setTimeout(() => {
            controller.abort();
            resolve({ ...emptyVerdict(), reason: 'deadline_exceeded' });
          }, config.deadlineMs);
        });
        const work = run(input, verdict, controller.signal, options?.cacheOnly === true);
        const result = await Promise.race([work, deadline]);
        if (performance.now() - started >= config.deadlineMs) {
          controller.abort();
          return { ...emptyVerdict(), reason: 'deadline_exceeded' };
        }
        return result;
      } finally {
        clearTimeout(timer);
      }
    },
    async warm(options?: WarmOptions): Promise<WarmResult> {
      let now = NaN;
      try {
        now = config.now();
      } catch {
        // An unusable clock fails every prefetch below.
      }
      const jobs = [...targets.values()].filter(
        ([, kind]) => kind === 'directory' || options?.ipLists === true,
      );
      const results = await Promise.allSettled(
        jobs.map(([url, kind, decode]) =>
          Number.isFinite(now) && now <= 1e11
            ? cache.load(url, kind, now, decode, 'warm')
            : Promise.reject(new Failure('invalid_clock', true)),
        ),
      );
      const result: WarmResult = { ok: [], failed: [] };
      jobs.forEach(([url, kind, decode], i) => {
        result[results[i].status === 'fulfilled' ? 'ok' : 'failed'].push(url);
        if (options?.refreshAhead === true) cache.keepWarm(url, kind, decode);
      });
      return result;
    },
    close(): void {
      cache.close();
    },
    status() {
      return cache.status([...targets.values()].map(([url, kind]) => [url, kind]));
    },
  };
}
/** Flat low-cardinality GA4/sGTM fields; raw claims and request data are not exported. */
export function toAnalyticsFields(
  verdict: AgentVerdict,
): Record<'agent_claim' | 'agent_verification' | 'agent_operator' | 'agent_purpose', string> {
  return {
    agent_claim: verdict.claimed.signatureAgents.length
      ? 'signature_agent'
      : verdict.claimed.uaTokens.length
        ? 'ua_token'
        : 'none',
    agent_verification: verdict.verification,
    agent_operator: verdict.verified?.operator ?? 'none',
    agent_purpose:
      verdict.verified && ['signature_valid', 'ip_match'].includes(verdict.verification)
        ? (verdict.agent_purpose ?? 'unknown')
        : 'unknown',
  };
}
