import { classifyTokenList, defaultTokenClasses } from './registry-token-classes.js';
import type { AgentPurpose, AgentVerdict, TokenClass } from './types.js';

export type VisitorType =
  | 'human'
  | 'unclassified'
  | 'agent_verified'
  | 'automation_verified'
  | 'agent_unverified'
  | 'crawler_verified'
  | 'crawler_unverified'
  | 'bot_automation'
  | 'bot_suspicious'
  | 'bot_spoofed';
/** Operators a browser detector may report from an observed page marker. */
export type BrowserAgent = 'openai' | 'anthropic';
export interface VisitorLabelsInput {
  verdict?: AgentVerdict;
  /** Fixed transport diagnostic supplied by a service adapter, never raw data. */
  diagnostic?:
    | 'pair_unavailable'
    | 'feed_unavailable'
    | 'service_unavailable'
    | 'config_suspect'
    | 'rejected';
  browserClass?: string;
  browserPhase?: string;
  /** Browser-observed operator; used only with `declared_agent` and no verified identity. */
  browserAgent?: string;
  /** Browser claim provenance; unknown values retain the legacy marker claim. */
  browserAgentClaim?: string;
  /** Optional custom token class map when `verdict.token_class` is absent; defaults to `defaultTokenClasses`. */
  tokenClasses?: Readonly<Record<string, TokenClass>>;
}
export interface VisitorLabels {
  vv_type: VisitorType;
  vv_detail: string;
}

const browserClasses = ['human', 'suspicious', 'automated', 'declared_agent'];
const browserPhases = ['initial', 'final', 'agent'];
const browserAgents: readonly string[] = ['openai', 'anthropic'] satisfies BrowserAgent[];
const purposes: readonly string[] = [
  'user_directed',
  'crawler',
  'intermediary',
  'unknown',
] satisfies AgentPurpose[];
const tokenClassValues: readonly string[] = [
  'agent',
  'fetcher',
  'crawler',
  'intermediary',
  'unknown',
];

function resolveTokenClass(
  verdict: AgentVerdict | undefined,
  tokenClasses: Readonly<Record<string, TokenClass>> | undefined,
): TokenClass | 'unknown' {
  if (!verdict) return 'unknown';
  if (verdict.token_class !== undefined)
    return tokenClassValues.includes(verdict.token_class) ? verdict.token_class : 'unknown';
  return classifyTokenList(verdict.claimed.uaTokens, tokenClasses ?? defaultTokenClasses);
}

/** Pure, bounded GA4 event labels. No raw claims, request data or diagnostic reasons. */
export function visitorLabels({
  verdict,
  diagnostic,
  browserClass,
  browserPhase,
  browserAgent,
  browserAgentClaim,
  tokenClasses,
}: VisitorLabelsInput = {}): VisitorLabels {
  const verification = verdict?.verification ?? '-';
  const verified = verification === 'signature_valid' || verification === 'ip_match';
  // Only known purposes reach the label; anything else is unknown, never copied through.
  const purpose = verified
    ? purposes.includes(verdict?.agent_purpose ?? '')
      ? verdict!.agent_purpose
      : 'unknown'
    : verdict
      ? 'unknown'
      : '-';
  const browser = browserClasses.includes(browserClass ?? '') ? browserClass! : '-';
  const phase = browserPhases.includes(browserPhase ?? '') ? browserPhase! : '-';
  // A page marker is observed evidence, never verification: verified identity and an invalid
  // signature both take precedence, and the marker never changes the visitor type.
  const marker =
    !verified &&
    verification !== 'signature_invalid' &&
    browser === 'declared_agent' &&
    browserAgents.includes(browserAgent ?? '')
      ? browserAgent!
      : undefined;
  const claim = marker
    ? browserAgentClaim === 'dom_host'
      ? 'dom_host'
      : 'dom_marker'
    : verification === 'signature_valid' &&
        verdict?.verified?.method === 'signature' &&
        verdict.claimed.signatureAgents.length > 0
      ? 'signature_agent'
      : verdict
        ? verdict.claimed.poppySession
          ? 'poppy_session'
          : verdict.claimed.signatureAgents.length
            ? 'signature_agent'
            : verdict.claimed.uaTokens.length
              ? 'ua_token'
              : 'none'
        : '-';
  const tokenClass = resolveTokenClass(verdict, tokenClasses);
  const crawlerOrFetcher = tokenClass === 'crawler' || tokenClass === 'fetcher';
  let type: VisitorType;
  if (verification === 'signature_invalid') type = 'bot_spoofed';
  else if (
    verification === 'ip_mismatch' &&
    verdict?.ipTrusted === true &&
    verdict.ipListsFresh === true
  )
    type = 'bot_spoofed';
  else if (verified) {
    // Infrastructure proves its platform identity; the downstream agent remains unknown.
    // Verified WBA/Poppy signatures follow purpose; IP-verified fetchers and crawlers are crawler_verified.
    type =
      purpose === 'intermediary'
        ? 'automation_verified'
        : purpose === 'crawler' || (verification === 'ip_match' && crawlerOrFetcher)
          ? 'crawler_verified'
          : 'agent_verified';
  } else if (browser === 'automated') type = 'bot_automation';
  else if (
    verification === 'ip_mismatch' ||
    browser === 'declared_agent' ||
    claim === 'ua_token' ||
    claim === 'signature_agent' ||
    claim === 'poppy_session'
  ) {
    // Unverified browser declarations, WBA/Poppy claims, agent tokens and unmapped UA claims stay
    // agent_unverified; pure UA claims with explicit crawler/fetcher class become crawler_unverified.
    type =
      browser !== 'declared_agent' && claim === 'ua_token' && crawlerOrFetcher
        ? 'crawler_unverified'
        : 'agent_unverified';
  } else if (browser === 'suspicious') type = 'bot_suspicious';
  else if (browser === 'human') type = 'human';
  else type = 'unclassified';
  const safeDiagnostic = [
    'pair_unavailable',
    'feed_unavailable',
    'service_unavailable',
    'config_suspect',
    'rejected',
  ].includes(diagnostic ?? '')
    ? diagnostic
    : undefined;
  const suffix = [safeDiagnostic ?? verification, purpose, claim, browser, phase].join('|');
  const candidate = verified ? verdict?.verified?.operator : marker;
  // Operators are trusted configuration, but an arbitrary configured string is not an analytics label.
  const operator =
    candidate &&
    /^[a-z][a-z0-9_]{0,23}$/.test(candidate) &&
    candidate.length + 1 + suffix.length <= 100
      ? candidate
      : 'none';
  return { vv_type: type, vv_detail: operator + '|' + suffix };
}
