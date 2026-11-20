import { AgentCache } from './cache.js';
import { validateConfig } from './config.js';
import { parseClaims } from './claims.js';
import { assertHeadersInput, headers, field } from './headers.js';
import { dictionary, coveredHeaderNames as collectCoveredHeaderNames } from './fields.js';
import { Failure, failure } from './errors.js';
import { checkContext, selectOutcome } from './policy.js';
import { evaluateSignature } from './signature.js';
import { ipEvidence } from './ip.js';
import type { AgentRequest, AgentVerdict, AgentVerifier, VerifierOptions } from './types.js';
export type * from './types.js';
export { defaultRegistry } from './registry.js';

/** Collect covered field names for adapters without exposing internal SF parser types. */
export function coveredHeaderNames(signatureInput: string): string[] {
  return collectCoveredHeaderNames(signatureInput);
}

function emptyVerdict(): AgentVerdict {
  return {
    claimed: { uaTokens: [], signatureAgents: [] },
    verification: 'none',
    reason: 'internal_error',
    signatures: [],
  };
}
/** Validate trusted configuration once and create a verifier with an owned cache. */
export function createVerifier(options: VerifierOptions): AgentVerifier {
  const config = validateConfig(options);
  const cache = new AgentCache(config.fetcher, config.fetchTimeoutMs);

  async function run(
    input: AgentRequest,
    verdict: AgentVerdict,
    signal: AbortSignal,
  ): Promise<AgentVerdict> {
    let presented = false;
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
        const inputs = dictionary(field(h, 'signature-input'));
        const sigs = dictionary(field(h, 'signature'));
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
          });
          if (signal.aborted) throw new Failure('deadline_exceeded', true);
          verdict.signatures.push(evaluation.result);
          verdict.verified ??= evaluation.verified;
        }
      }
      if (signal.aborted) throw new Failure('deadline_exceeded', true);
      if (!claims.agent.values.length || trusted)
        verdict.ip = await ipEvidence(input.clientIp, claims.uaTokens, config.registry, cache, now);
      if (signal.aborted) throw new Failure('deadline_exceeded', true);
      Object.assign(verdict, selectOutcome(verdict.signatures, presented, verdict.ip));
      if (verdict.verification === 'ip_match')
        verdict.verified = { operator: verdict.ip!.operator, method: 'ip' };
    } catch (error) {
      const f = failure(error);
      verdict.verification = presented && !f.indeterminate ? 'signature_invalid' : 'none';
      verdict.reason = f.reason;
      verdict.verified = undefined;
    }
    return verdict;
  }

  return {
    async verify(input: AgentRequest): Promise<AgentVerdict> {
      // Unsupported container types are integration/programmer errors, not visitor verdicts.
      assertHeadersInput(input?.headers);
      const started = performance.now();
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const verdict = emptyVerdict();
      try {
        const work = run(input, verdict, controller.signal);
        const deadline = new Promise<AgentVerdict>((resolve) => {
          timer = setTimeout(() => {
            controller.abort();
            resolve({ ...emptyVerdict(), reason: 'deadline_exceeded' });
          }, config.deadlineMs);
        });
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
  };
}
/** Flat low-cardinality GA4/sGTM fields; raw claims and request data are not exported. */
export function toAnalyticsFields(
  verdict: AgentVerdict,
): Record<'agent_claim' | 'agent_verification' | 'agent_operator', string> {
  return {
    agent_claim: verdict.claimed.signatureAgents.length
      ? 'signature_agent'
      : verdict.claimed.uaTokens.length
        ? 'ua_token'
        : 'none',
    agent_verification: verdict.verification,
    agent_operator: verdict.verified?.operator ?? 'none',
  };
}
