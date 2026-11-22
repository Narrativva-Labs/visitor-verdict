import type { AgentPurpose, AgentVerdict, Operator, Registry, ReverseDnsRule } from './types.js';

/** Internal provenance retained with DNS cache evidence, never exposed in a visitor verdict. */
export interface DnsPurposeEvidence {
  operator: Operator;
  rule: ReverseDnsRule;
}

/** Purpose follows the winning verified evidence, never another operator's claim. */
export function purposeFor(
  verdict: AgentVerdict,
  registry: Registry,
  dnsEvidence?: DnsPurposeEvidence,
): AgentPurpose {
  if (!verdict.verified || !['signature_valid', 'ip_match'].includes(verdict.verification))
    return 'unknown';
  const operator =
    verdict.verified.method === 'rdns'
      ? dnsEvidence?.operator
      : registry.find(
          (entry) =>
            entry.operator === verdict.verified!.operator &&
            (verdict.verified!.method !== 'signature' ||
              (verdict.verified!.signatureAgent !== undefined &&
                entry.signatureAgent === verdict.verified!.signatureAgent)),
        );
  // Infrastructure signs for other parties' agents: its identity never names the agent's role.
  if (verdict.verified.method === 'signature' && operator?.intermediary === true)
    return 'intermediary';
  const policy = operator?.purposes;
  if (!policy) return 'unknown';
  if (verdict.verified.method === 'signature') return policy.signatureAgent ?? 'unknown';
  const list = verdict.ip?.list;
  if (list && policy.ipLists && Object.hasOwn(policy.ipLists, list)) return policy.ipLists[list];
  const eligible =
    verdict.verified.method === 'rdns'
      ? dnsEvidence?.rule.uaTokens
      : list === 'published_static'
        ? operator?.extraUaTokens
        : operator?.ipLists.find((entry) => entry.name === list)?.uaTokens;
  const purposes = new Set(
    verdict.claimed.uaTokens
      .filter((token) => eligible?.includes(token))
      .map((token) => policy.uaTokens?.[token] ?? 'unknown'),
  );
  return purposes.size === 1 ? purposes.values().next().value! : 'unknown';
}
