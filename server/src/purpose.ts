import type { AgentPurpose, AgentVerdict, Registry } from './types.js';

/** Purpose follows the winning verified evidence, never another operator's claim. */
export function purposeFor(verdict: AgentVerdict, registry: Registry): AgentPurpose {
  if (!verdict.verified || !['signature_valid', 'ip_match'].includes(verdict.verification))
    return 'unknown';
  const operator = registry.find(
    (entry) =>
      entry.operator === verdict.verified!.operator &&
      (verdict.verified!.method !== 'signature' ||
        (verdict.verified!.signatureAgent !== undefined &&
          entry.signatureAgent === verdict.verified!.signatureAgent)),
  );
  const policy = operator?.purposes;
  if (!policy) return 'unknown';
  if (verdict.verified.method === 'signature') return policy.signatureAgent ?? 'unknown';
  const list = verdict.ip?.list;
  if (list && policy.ipLists && Object.hasOwn(policy.ipLists, list)) return policy.ipLists[list];
  const eligible = operator?.ipLists.find((entry) => entry.name === list)?.uaTokens;
  const purposes = new Set(
    verdict.claimed.uaTokens
      .filter(
        (token) =>
          (!eligible || eligible.includes(token)) && Object.hasOwn(policy.uaTokens ?? {}, token),
      )
      .map((token) => policy.uaTokens![token]),
  );
  return purposes.size === 1 ? purposes.values().next().value! : 'unknown';
}
