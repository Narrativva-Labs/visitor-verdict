import type { Registry, TokenClass } from './types.js';

/**
 * Explicit product class of recognized UA tokens, derived from operator documentation
 * rather than token name suffixes. Unmapped tokens (such as Naver's undocumented `Blueno`
 * or unknown custom tokens) stay unmapped and remain conservative `agent_unverified`
 * when unverified (`agent_verified` if IP-verified with unknown purpose).
 *
 * - `agent`: interactive browser/agent that navigates pages and can convert (`agent_*`).
 * - `fetcher`: user-directed page downloader without interactive browser browsing (`crawler_*`).
 * - `crawler`: automated web crawler/indexer/ad crawler (`crawler_*`).
 * - `intermediary`: signing/browser infrastructure acting for other parties (`automation_verified`).
 */
export const tokenClassPolicies: Readonly<Record<string, Readonly<Record<string, TokenClass>>>> = {
  openai: {
    'ChatGPT-User': 'fetcher',
    'OAI-SearchBot': 'crawler',
    GPTBot: 'crawler',
    'OAI-AdsBot': 'crawler',
  },
  google: {
    'Google-Agent': 'agent',
    'Google-GeminiNotebook': 'fetcher',
    'Google-NotebookLM': 'fetcher',
    'Gemini-Deep-Research': 'fetcher',
    'Google-Pinpoint': 'fetcher',
    'Google-Read-Aloud': 'fetcher',
    GoogleProducer: 'fetcher',
    'Google-Site-Verification': 'fetcher',
    'Google-CWS': 'fetcher',
    'FeedFetcher-Google': 'fetcher',
    Googlebot: 'crawler',
    'Google-CloudVertexBot': 'crawler',
    'Googlebot-Image': 'crawler',
    'Googlebot-Video': 'crawler',
    'Storebot-Google': 'crawler',
    'Google-InspectionTool': 'crawler',
    GoogleOther: 'crawler',
    'GoogleOther-Image': 'crawler',
    'GoogleOther-Video': 'crawler',
  },
  anthropic: {
    'Claude-Agent': 'agent',
    'Claude-User': 'fetcher',
    ClaudeBot: 'crawler',
    'Claude-SearchBot': 'crawler',
  },
  perplexity: {
    'Perplexity-User': 'fetcher',
    PerplexityBot: 'crawler',
  },
  mistral: {
    'MistralAI-User': 'fetcher',
    'MistralAI-Index': 'crawler',
    'MistralAI-Training': 'crawler',
  },
  kimi: {
    'Kimi-User': 'fetcher',
    KimiBot: 'crawler',
    'Kimi-SearchBot': 'crawler',
  },
  duckduckgo: {
    DuckAssistBot: 'crawler',
  },
  apple: {
    Applebot: 'crawler',
  },
  microsoft: {
    bingbot: 'crawler',
    AdIdxBot: 'crawler',
    BingPreview: 'fetcher',
    MicrosoftPreview: 'fetcher',
    BingVideoPreview: 'fetcher',
  },
  commoncrawl: {
    CCBot: 'crawler',
  },
  seznam: {
    SeznamBot: 'crawler',
  },
  naver: {
    Yeti: 'crawler',
    'Ads-Naver': 'crawler',
    // Blueno is intentionally omitted: Naver's firewall guide does not document its product role.
  },
  kagi: {
    Kagibot: 'crawler',
  },
  baidu: {
    Baiduspider: 'crawler',
  },
  petal: {
    PetalBot: 'crawler',
  },
  yandex: {
    YandexBot: 'crawler',
    YandexAdditional: 'crawler',
  },
  amazon: {
    Amazonbot: 'crawler',
    'Amzn-SearchBot': 'crawler',
    'Amzn-User': 'fetcher',
  },
  amazonads: {
    AmazonAdBot: 'crawler',
  },
  meta: {
    // Documented by Meta as a web crawler for training/product indexing, not a browser agent.
    'meta-externalagent': 'crawler',
    'meta-externalfetcher': 'fetcher',
    'meta-webindexer': 'crawler',
  },
  you: {
    YouBot: 'crawler',
  },
  sogou: {
    Sogou: 'crawler',
  },
  bytedance: {
    Bytespider: 'crawler',
    TikTokSpider: 'crawler',
  },
  deepseek: {
    DeepSeekBot: 'crawler',
  },
  zhipu: {
    'ChatGLM-Spider': 'crawler',
  },
  shenma: {
    YisouSpider: 'crawler',
  },
  qihoo: {
    '360Spider': 'crawler',
  },
  diffbot: {
    Diffbot: 'crawler',
  },
  timpi: {
    Timpibot: 'crawler',
  },
};

/** Flat default map of documented UA tokens to their product class. */
export const defaultTokenClasses: Readonly<Record<string, TokenClass>> = Object.freeze(
  Object.assign({}, ...Object.values(tokenClassPolicies)),
);

/** Combine built-in documented token classes with any registry-specific token class overrides. */
export function tokenClassesFor(registry: Registry): Record<string, TokenClass> {
  const combined: Record<string, TokenClass> = { ...defaultTokenClasses };
  for (const operator of registry)
    if (operator.tokenClasses) Object.assign(combined, operator.tokenClasses);
  return combined;
}

/**
 * Reduce a set of matched UA tokens to one effective token class.
 * Any unmapped token or agent/non-agent conflict stays `unknown` so an unknown or
 * mixed claim is never downgraded to `crawler_*`. Mixed `crawler` + `fetcher` tokens
 * share the crawler analytics bucket and reduce to `crawler`.
 */
export function classifyTokenList(
  tokens: readonly string[],
  classes: Readonly<Record<string, TokenClass>> = defaultTokenClasses,
): TokenClass | 'unknown' {
  if (!tokens.length) return 'unknown';
  let kind: TokenClass | undefined;
  for (const token of tokens) {
    const next = Object.hasOwn(classes, token) ? classes[token] : undefined;
    if (!next) return 'unknown';
    if (!kind) kind = next;
    else if (kind !== next) {
      if ((kind === 'crawler' || kind === 'fetcher') && (next === 'crawler' || next === 'fetcher'))
        kind = 'crawler';
      else return 'unknown';
    }
  }
  return kind ?? 'unknown';
}
