import { PoppyVerifier, poppyMetadata, poppyKeys } from './poppy.js';
import { headerMismatch } from './header-consistency.js';
import { createClaimParser } from './claims.js';
import { requiredHeaderNames as collectRequiredHeaderNames } from './fields.js';
import { AgentCache, type DocumentKind } from './cache.js';
import { validateConfig } from './config.js';
import { assertHeadersInput, headers, field } from './headers.js';
import { parsedDictionary, coveredHeaderNames as collectCoveredHeaderNames } from './fields.js';
import { Failure, failure } from './errors.js';
import { checkContext, selectOutcome } from './policy.js';
import { evaluateSignature } from './signature.js';
import { ReverseDnsVerifier } from './rdns.js';
import { staticBlocks, ipEvidence, ipMismatch, decodeList, decodeSail } from './ip.js';
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
/** Validate trusted configuration once and create a verifier with an owned cache, or a caller-owned cache shared by authority batches. */
export function createVerifier(options: VerifierOptions, sharedCache?: AgentCache): AgentVerifier {
  const config = validateConfig(options);
  const cache =
    sharedCache ??
    new AgentCache(config.fetcher, config.fetchTimeoutMs, {
      staleMaxSeconds: config.staleMaxSeconds,
      now: config.now,
      onRefresh: config.onRefresh,
    });
  const poppy = config.poppy
    ? new PoppyVerifier(
        config.registry,
        cache,
        config.now,
        config.poppyReplayStore,
        config.fetchTimeoutMs,
      )
    : undefined;
  const parseClaims = createClaimParser(config.registry);
  const staticRanges = staticBlocks(config.registry);
  const rdns = config.reverseDns
    ? new ReverseDnsVerifier(config.reverseDns, config.registry)
    : undefined;
  const targets = new Map<string, [string, DocumentKind, (data: unknown) => unknown]>();
  for (const operator of config.registry) {
    if (poppy && operator.poppyClientId && operator.poppyJwksUri) {
      const client = operator.poppyClientId,
        jwks = operator.poppyJwksUri;
      targets.set('directory:' + client, [
        client,
        'directory',
        (d) => poppyMetadata(d, client, jwks),
      ]);
      targets.set('directory:' + jwks, [jwks, 'directory', poppyKeys]);
    }
    if (operator.directoryUrl)
      targets.set('directory:' + operator.directoryUrl, [
        operator.directoryUrl,
        'directory',
        publicKeys,
      ]);
    for (const list of operator.ipLists) {
      if (list.complete)
        cache.requireComplete(list.url, list.format === 'sail' ? list.service : undefined);
      const kind = list.format === 'sail' ? 'sail' : 'ip';
      targets.set(kind + ':' + list.url, [
        list.url,
        kind,
        kind === 'sail' ? decodeSail : decodeList,
      ]);
    }
  }

  // URL download readiness is separate from this verifier's configured services.
  // Do not discard shared cache data needed by another verifier.
  const sailServices = new Map<string, Set<string>>();
  for (const op of config.registry)
    for (const list of op.ipLists)
      if (list.format === 'sail') {
        const names = sailServices.get(list.url) ?? new Set<string>();
        names.add(list.service!);
        sailServices.set(list.url, names);
      }
  const sailReady = (url: string, now: number) =>
    [...(sailServices.get(url) ?? [])].every(
      (name) => cache.serviceStatus(url, name, now).available,
    );

  const isIntermediary = (verified: NonNullable<AgentVerdict['verified']>) =>
    config.registry.some(
      (o) => o.intermediary === true && o.signatureAgent === verified.signatureAgent,
    );

  async function run(
    input: AgentRequest,
    verdict: AgentVerdict,
    signal: AbortSignal,
    cacheOnly: boolean,
    deadlineAt: number,
    admission?: VerifyOptions,
  ): Promise<AgentVerdict> {
    let presented = false;
    const directoryLoads = new Map<string, { fetched: boolean }>();
    let dnsPurpose: DnsPurposeEvidence | undefined;
    try {
      const h = headers(input.headers);
      presented = h.has('signature') || h.has('signature-input');
      const context = checkContext(input, config.authorities);
      if (
        input.secure !== false &&
        input.headerDiagnostics !== false &&
        headerMismatch(h, input.method)
      )
        verdict.evidence = ['header_mismatch'];
      let now: number;
      try {
        now = config.now();
      } catch {
        throw new Failure('invalid_clock', true);
      }
      if (!Number.isFinite(now) || now > 1e11) throw new Failure('invalid_clock', true);
      const claims = parseClaims(h);
      verdict.claimed = { uaTokens: claims.uaTokens, signatureAgents: claims.agent.values };
      const identities = claims.agent.legacy
        ? [claims.agent.legacy]
        : [...claims.agent.identities.values()];
      const bareIdentity =
        identities.length &&
        identities.every((id) => id === identities[0]) &&
        (claims.agent.legacy || claims.agent.identities.size === claims.agent.members?.size) &&
        config.registry.some((o) => o.signatureAgent === identities[0])
          ? identities[0]
          : undefined;
      const hasAgent = !!field(h, 'signature-agent');
      if (hasAgent && !verdict.claimed.signatureAgents.length)
        verdict.claimed.signatureAgents = ['(non-string)'];
      if (poppy && h.has('poppy-session')) verdict.claimed.poppySession = true;
      if (presented) {
        if (!field(h, 'signature') || !field(h, 'signature-input'))
          throw new Failure('incomplete_signature_headers');
        const rawInput = field(h, 'signature-input');
        const parsedInputs = parsedDictionary(rawInput, 'signature-input');
        const parsedSignatures = parsedDictionary(field(h, 'signature'), 'signature');
        const inputs = parsedInputs.members;
        const sigs = parsedSignatures.members;
        const labels = [...new Set([...inputs.keys(), ...sigs.keys()])];
        if (labels.length > 4) throw new Failure('too_many_signatures');
        for (const member of inputs.values())
          if (Array.isArray(member[0]) && member[0].length > 32)
            throw new Failure('too_many_components');
        for (const label of labels) {
          const evaluation =
            admission?.signatureFilter && !admission.signatureFilter(label)
              ? {
                  result: { label, result: 'none' as const, reason: 'unsupported_component' },
                  verified: undefined,
                }
              : admission?.isReplay?.(label)
                ? {
                    result: { label, result: 'none' as const, reason: 'replay' },
                    verified: undefined,
                  }
                : await evaluateSignature(label, inputs, sigs, {
                    context,
                    headers: h,
                    agent: claims.agent,
                    registry: config.registry,
                    cache,
                    now,
                    signal,
                    nonceStore: config.nonceStore,
                    nonceTimeoutMs: config.fetchTimeoutMs,
                    fields: {
                      inputs: parsedInputs,
                      signatures: parsedSignatures,
                      agent: claims.agent,
                    },
                    maxLifetimeSeconds: config.maxLifetimeSeconds,
                    cacheOnly,
                    secure: input.secure,
                    directoryLoads,
                  });
          if (signal.aborted) throw new Failure('deadline_exceeded', true);
          // Admission is synchronous so adapters can atomically commit verified bytes.
          if (
            evaluation.verified &&
            admission?.acceptSignature &&
            !admission.acceptSignature(label, evaluation.verified)
          ) {
            evaluation.verified = undefined;
            evaluation.result = { label, result: 'none', reason: 'replay' };
          }
          verdict.signatures.push(evaluation.result);
          // A valid direct identity wins over a valid intermediary (signing infrastructure),
          // so infrastructure is never reported in place of the agent that also signed.
          if (
            evaluation.verified &&
            (!verdict.verified ||
              (isIntermediary(verdict.verified) && !isIntermediary(evaluation.verified)))
          )
            verdict.verified = evaluation.verified;
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
      const bareAllowed = !hasAgent || !!bareIdentity || onlyIgnored;
      const ipRegistry =
        bareIdentity && !onlyIgnored
          ? config.registry.filter((o) => o.signatureAgent === bareIdentity)
          : config.registry;
      if (bareAllowed) {
        const evidence = await ipEvidence(
          input.clientIp,
          claims.uaTokens,
          ipRegistry,
          cache,
          now,
          staticRanges,
          cacheOnly,
        );
        if (input.ipTrusted !== false) verdict.ip = evidence.ip;
        if (evidence.shared) verdict.evidence = [...(verdict.evidence ?? []), 'shared_ip_range'];
        ipUnavailable = evidence.unavailable;
        ipCacheMiss = evidence.cacheMiss === true;
        if (
          !verdict.ip &&
          !verdict.verified &&
          rdns &&
          input.ipTrusted !== false &&
          !cacheOnly &&
          !(poppy && h.has('poppy-session'))
        ) {
          const dns = await rdns.verify(input.clientIp, claims.uaTokens, now, signal);
          if (dns.operator) {
            verdict.rdns = { operator: dns.operator };
            dnsPurpose = dns.matched;
          } else if (dns.unavailable && !ipUnavailable) dnsUnavailable = true;
          else if (dns.notConfirmed) dnsNotConfirmed = true;
        }
      }
      if (poppy && h.has('poppy-session')) {
        const outcome = await poppy.evaluate(h, input, now, cacheOnly, signal, deadlineAt);
        if (signal.aborted || performance.now() >= deadlineAt)
          throw new Failure('deadline_exceeded', true);
        verdict.poppy = outcome.diagnostic;
        verdict.signatures.push({
          label: 'poppy',
          result: outcome.diagnostic.result,
          reason: outcome.diagnostic.reason,
        });
        presented = true;
        if (outcome.verified && (!verdict.verified || isIntermediary(verdict.verified)))
          verdict.verified = outcome.verified;
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
          verdict.verified !== undefined && isIntermediary(verdict.verified),
        ),
      );
      if (!bareAllowed && !presented) {
        verdict.verification = 'none';
        verdict.reason = 'untrusted_signature_agent';
      }
      if (verdict.reason === 'ip_evidence_unavailable' && ipCacheMiss)
        verdict.reason = 'cache_miss';
      if (verdict.verification === 'ip_match') {
        if (verdict.ip) verdict.verified = { operator: verdict.ip.operator, method: 'ip' };
        else {
          verdict.reason = 'reverse_dns_match';
          verdict.verified = { operator: verdict.rdns!.operator, method: 'rdns' };
        }
      } else if (verdict.verification !== 'signature_valid') {
        verdict.verified = undefined;
        if (verdict.verification === 'no_signature' && dnsUnavailable) {
          verdict.verification = 'none';
          verdict.reason = 'reverse_dns_unavailable';
        } else if (verdict.verification === 'no_signature' && dnsNotConfirmed) {
          verdict.reason = 'reverse_dns_not_confirmed';
        }
      }
      if (
        config.flagSpoofedClaims &&
        bareAllowed &&
        ((!h.has('signature') && !h.has('signature-input')) || onlyIgnored) &&
        !(poppy && h.has('poppy-session')) &&
        !verdict.verified
      ) {
        const mismatch = await ipMismatch(
          input.clientIp,
          claims.uaTokens,
          ipRegistry,
          cache,
          config.now(),
          staticRanges,
        );
        if (mismatch) {
          verdict.verification = 'ip_mismatch';
          verdict.reason = 'official_ip_range_mismatch';
          verdict.ipTrusted = input.ipTrusted !== false;
          verdict.ipListsFresh = mismatch.fresh;
        }
      }
    } catch (error) {
      const f = failure(error);
      verdict.verification = 'none';
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
        const work = run(
          input,
          verdict,
          controller.signal,
          options?.cacheOnly === true,
          started + config.deadlineMs,
          options,
        );
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
        result[
          results[i].status === 'fulfilled' && (kind !== 'sail' || sailReady(url, now))
            ? 'ok'
            : 'failed'
        ].push(url);
        if (options?.refreshAhead === true) cache.keepWarm(url, kind, decode);
      });
      return result;
    },
    close(): void {
      if (!sharedCache) cache.close();
    },
    status() {
      const result = cache.status([...targets.values()].map(([url, kind]) => [url, kind]));
      for (const [url, kind] of targets.values())
        if (
          kind === 'sail' &&
          !sailReady(url, config.now()) &&
          cache.status([[url, kind]]).ipLists.loaded
        )
          result.ipLists.loaded--;
      return result;
    },
  };
}
export { visitorLabels } from './labels.js';
export { serverAgentTokens } from './server-tokens.js';
export type { VisitorType, VisitorLabelsInput, VisitorLabels, BrowserAgent } from './labels.js';

export { MemoryNonceStore } from './replay.js';
