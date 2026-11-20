import type { AgentVerdict } from './types.js';

export type VisitorType =
  | 'human'
  | 'pending'
  | 'agent_verified'
  | 'agent_unverified'
  | 'crawler_verified'
  | 'bot_automation'
  | 'bot_suspicious'
  | 'bot_spoofed';
export interface VisitorLabelsInput {
  verdict?: AgentVerdict;
  browserClass?: string;
  browserPhase?: string;
}
export interface VisitorLabels {
  vv_type: VisitorType;
  vv_detail: string;
}

/** Pure, bounded GA4 event labels. No raw claims, request data or diagnostic reasons. */
export function visitorLabels({
  verdict,
  browserClass,
  browserPhase,
}: VisitorLabelsInput = {}): VisitorLabels {
  const verification = verdict?.verification ?? '-';
  const verified = verification === 'signature_valid' || verification === 'ip_match';
  const purpose = verified ? (verdict?.agent_purpose ?? 'unknown') : verdict ? 'unknown' : '-';
  const claim = verdict
    ? verdict.claimed.signatureAgents.length
      ? 'signature_agent'
      : verdict.claimed.uaTokens.length
        ? 'ua_token'
        : 'none'
    : '-';
  const browser = ['human', 'suspicious', 'automated', 'declared_agent'].includes(
    browserClass ?? '',
  )
    ? browserClass!
    : '-';
  const phase = ['initial', 'final'].includes(browserPhase ?? '') ? browserPhase! : '-';
  let type: VisitorType;
  if (verification === 'signature_invalid') type = 'bot_spoofed';
  else if (verified) {
    // Unknown purpose retains verified identity without asserting a user-directed role.
    type = purpose === 'crawler' ? 'crawler_verified' : 'agent_verified';
  } else if (browser === 'automated') type = 'bot_automation';
  else if (browser === 'declared_agent' || claim === 'ua_token' || claim === 'signature_agent')
    type = 'agent_unverified';
  else if (browser === 'suspicious') type = 'bot_suspicious';
  else if (browser === 'human') type = 'human';
  else type = 'pending';
  const suffix = [verification, purpose, claim, browser, phase].join('|');
  const candidate = verified ? verdict?.verified?.operator : undefined;
  // Operators are trusted configuration, but an arbitrary configured string is not an analytics label.
  const operator =
    candidate &&
    /^[a-z][a-z0-9_]{0,23}$/.test(candidate) &&
    candidate.length + 1 + suffix.length <= 100
      ? candidate
      : 'none';
  return { vv_type: type, vv_detail: operator + '|' + suffix };
}
