import { classifyTokenList, tokenClassesFor } from './registry-token-classes.js';
import type {
  AgentPurpose,
  AgentVerdict,
  Operator,
  Registry,
  ReverseDnsRule,
  TokenClass,
} from './types.js';

/** Internal provenance retained with DNS cache evidence, never exposed in a visitor verdict. */
export interface DnsPurposeEvidence {
  operator: Operator;
  rule: ReverseDnsRule;
}

function findVerifiedOperator(
  verdict: AgentVerdict,
  registry: Registry,
  dnsEvidence?: DnsPurposeEvidence,
): Operator | undefined {
  if (!verdict.verified) return undefined;
  return verdict.verified.method === 'rdns'
    ? dnsEvidence?.operator
    : registry.find(
        (entry) =>
          entry.operator === verdict.verified!.operator &&
          (verdict.verified!.method !== 'signature' ||
            (verdict.verified!.signatureAgent !== undefined &&
              entry.signatureAgent === verdict.verified!.signatureAgent)),
      );
}

function eligibleTokens(
  verdict: AgentVerdict,
  operator: Operator | undefined,
  dnsEvidence?: DnsPurposeEvidence,
): readonly string[] | undefined {
  if (!verdict.verified) return undefined;
  const list = verdict.ip?.list;
  return verdict.verified.method === 'rdns'
    ? dnsEvidence?.rule.uaTokens
    : list === 'published_static'
      ? operator?.extraUaTokens
      : operator?.ipLists.find((entry) => entry.name === list)?.uaTokens;
}

/** Purpose follows the winning verified evidence, never another operator's claim. */
export function purposeFor(
  verdict: AgentVerdict,
  registry: Registry,
  dnsEvidence?: DnsPurposeEvidence,
): AgentPurpose {
  if (!verdict.verified || !['signature_valid', 'ip_match'].includes(verdict.verification))
    return 'unknown';
  if (verdict.verified.method === 'poppy') return 'unknown';
  const operator = findVerifiedOperator(verdict, registry, dnsEvidence);
  // Infrastructure signs for other parties' agents: its identity never names the agent's role.
  if (verdict.verified.method === 'signature' && operator?.intermediary === true)
    return 'intermediary';
  const policy = operator?.purposes;
  if (!policy) return 'unknown';
  if (verdict.verified.method === 'signature') return policy.signatureAgent ?? 'unknown';
  const list = verdict.ip?.list;
  if (list && policy.ipLists && Object.hasOwn(policy.ipLists, list)) return policy.ipLists[list];
  const eligible = eligibleTokens(verdict, operator, dnsEvidence);
  const purposes = new Set(
    verdict.claimed.uaTokens
      .filter((token) => eligible?.includes(token))
      .map((token) => policy.uaTokens?.[token] ?? 'unknown'),
  );
  return purposes.size === 1 ? purposes.values().next().value! : 'unknown';
}

/** Effective token class for the winning verified evidence or unverified UA claims. */
export function tokenClassFor(
  verdict: AgentVerdict,
  registry: Registry,
  dnsEvidence?: DnsPurposeEvidence,
): TokenClass | 'unknown' {
  const classes = tokenClassesFor(registry);
  if (verdict.verification === 'signature_valid' && verdict.verified) {
    if (verdict.verified.method === 'poppy') return 'agent';
    const operator = findVerifiedOperator(verdict, registry, dnsEvidence);
    if (operator?.intermediary === true) return 'intermediary';
    if (verdict.agent_purpose === 'crawler') return 'crawler';
    return 'agent';
  }
  if (verdict.verification === 'ip_match' && verdict.verified) {
    const operator = findVerifiedOperator(verdict, registry, dnsEvidence);
    const eligible = eligibleTokens(verdict, operator, dnsEvidence);
    const matched = eligible
      ? verdict.claimed.uaTokens.filter((token) => eligible.includes(token))
      : verdict.claimed.uaTokens;
    if (matched.length) return classifyTokenList(matched, classes);
    if (verdict.agent_purpose === 'crawler') return 'crawler';
    if (verdict.agent_purpose === 'intermediary') return 'intermediary';
    return 'unknown';
  }
  return classifyTokenList(verdict.claimed.uaTokens, classes);
}
