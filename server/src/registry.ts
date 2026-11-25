import { additionalOperators } from './registry-extra.js';
import { purposePolicies } from './registry-purposes.js';
import { tokenClassPolicies } from './registry-token-classes.js';
import type { Registry } from './types.js';
const googleCommonTokens = [
  'Googlebot',
  'Googlebot-Image',
  'Googlebot-Video',
  'Storebot-Google',
  'Google-InspectionTool',
  'GoogleOther',
  'GoogleOther-Image',
  'GoogleOther-Video',
  'Google-CloudVertexBot',
];
const googleFetcherTokens = [
  'Google-GeminiNotebook',
  'Google-NotebookLM',
  'Gemini-Deep-Research',
  'Google-Pinpoint',
  'Google-Read-Aloud',
  'GoogleProducer',
  'Google-Site-Verification',
  'Google-CWS',
  'FeedFetcher-Google',
];
// Exact operator identities and endpoints; no discovery from request-controlled URLs.
const operators: Registry = [
  ...additionalOperators,
  {
    operator: 'apple',
    reverseDns: [
      {
        uaTokens: ['Applebot'],
        suffixes: ['applebot.apple.com'],
        source: 'https://support.apple.com/en-sg/119829',
        checked: '2026-11-20',
      },
    ],
    verifiedByCapture: false,
    checked: '2026-11-20',
    source: 'https://support.apple.com/en-sg/119829',
    ipLists: [
      {
        name: 'applebot',
        url: 'https://search.developer.apple.com/applebot.json',
        uaTokens: ['Applebot'],
      },
    ],
  },
  {
    operator: 'microsoft',
    reverseDns: [
      {
        uaTokens: ['bingbot'],
        suffixes: ['search.msn.com'],
        source: 'https://www.bing.com/webmasters/help/how-to-verify-bingbot-3905dc26',
        checked: '2026-11-20',
      },
    ],
    verifiedByCapture: false,
    checked: '2026-11-20',
    source: 'https://www.bing.com/webmasters/help/how-to-verify-bingbot-3905dc26',
    extraUaTokens: ['bingbot', 'AdIdxBot', 'BingPreview', 'MicrosoftPreview', 'BingVideoPreview'],
    ipLists: [
      { name: 'bingbot', url: 'https://www.bing.com/toolbox/bingbot.json', uaTokens: ['bingbot'] },
    ],
  },
  {
    operator: 'mistral',
    extraUaTokens: ['MistralAI-Training'],
    verifiedByCapture: false,
    checked: '2026-11-20',
    source: 'https://docs.mistral.ai/robots',
    ipLists: [
      {
        name: 'mistralai-user',
        url: 'https://mistral.ai/mistralai-user-ips.json',
        uaTokens: ['MistralAI-User'],
      },
      {
        name: 'mistralai-index',
        url: 'https://mistral.ai/mistralai-index-ips.json',
        uaTokens: ['MistralAI-Index'],
      },
    ],
  },
  {
    operator: 'duckduckgo',
    evidence: [
      {
        level: 'documented',
        source: 'https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot',
        checked: '2026-11-20',
        note: 'DuckAssistBot crawler role and IP list.',
      },
      {
        level: 'observed',
        source: 'https://radar.cloudflare.com/bots/directory/duckassistbot',
        checked: '2026-11-20',
        note: 'Published WBA directory; signature origin has no local request capture.',
      },
    ],
    signatureAgent: 'https://assistbot.duckduckgo.com',
    directoryUrl: 'https://assistbot.duckduckgo.com/.well-known/http-message-signatures-directory',
    verifiedByCapture: false,
    source: 'https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot',
    checked: '2026-11-20',
    ipLists: [
      {
        name: 'duckassistbot',
        url: 'https://duckduckgo.com/duckassistbot.json',
        uaTokens: ['DuckAssistBot'],
      },
    ],
  },
  {
    operator: 'openai',
    signatureAgent: 'https://chatgpt.com',
    directoryUrl: 'https://chatgpt.com/.well-known/http-message-signatures-directory',
    verifiedByCapture: true,
    source: 'https://developers.openai.com/commerce/agent-access',
    checked: '2026-11-20',
    ipLists: [
      {
        name: 'chatgpt-user',
        complete: true,
        source: 'https://developers.openai.com/api/docs/bots',
        checked: '2026-11-24',
        url: 'https://openai.com/chatgpt-user.json',
        uaTokens: ['ChatGPT-User'],
      },
      {
        name: 'searchbot',
        complete: true,
        source: 'https://developers.openai.com/api/docs/bots',
        checked: '2026-11-24',
        url: 'https://openai.com/searchbot.json',
        uaTokens: ['OAI-SearchBot'],
      },
      {
        name: 'gptbot',
        complete: true,
        source: 'https://developers.openai.com/api/docs/bots',
        checked: '2026-11-24',
        url: 'https://openai.com/gptbot.json',
        uaTokens: ['GPTBot'],
      },
      {
        name: 'adsbot',
        complete: true,
        source: 'https://developers.openai.com/api/docs/bots',
        checked: '2026-11-24',
        url: 'https://openai.com/adsbot.json',
        uaTokens: ['OAI-AdsBot'],
      },
    ],
  },
  {
    operator: 'google',
    extraUaTokens: [...googleCommonTokens, ...googleFetcherTokens],
    evidence: [
      {
        level: 'documented',
        source:
          'https://developers.google.com/crawling/docs/crawlers-fetchers/verify-google-requests',
        checked: '2026-11-20',
        note: 'Common crawlers and managed fetchers; customer GCE DNS is excluded.',
      },
      {
        level: 'observed',
        source: 'https://knownagents.com/agents/gemini-deep-research',
        checked: '2026-11-19',
        uaTokens: ['Gemini-Deep-Research'],
        note: 'Observed token in Known Agents, Dark Visitors and Cloudflare AI-assistant reporting; not documented by Google.',
      },
      {
        level: 'inferred',
        source:
          'https://developers.google.com/crawling/docs/crawlers-fetchers/verify-google-requests',
        checked: '2026-11-20',
        uaTokens: ['Gemini-Deep-Research'],
        note: 'Owner-approved mapping to managed-fetchers and agents feeds and google.com FCrDNS; not a Google-documented token mapping.',
      },
      {
        level: 'documented',
        source: 'https://developers.google.com/crawling/docs/crawlers-fetchers/web-bot-auth',
        checked: '2026-11-22',
        note: 'Experimental: Google-Agent signs only a subset of requests as Signature-Agent g="https://agent.bot.goog" with Signature/Signature-Input label g; unsigned requests fall back to IP verification. Live directory re-checked 2026-11-22 (five keys with short custom kids).',
      },
    ],
    allowKidAlias: true,
    reverseDns: [
      {
        uaTokens: ['Google-Agent', ...googleFetcherTokens],
        suffixes: ['google.com'],
        source:
          'https://developers.google.com/crawling/docs/crawlers-fetchers/verify-google-requests',
        checked: '2026-11-20',
      },
      {
        uaTokens: googleCommonTokens,
        suffixes: ['googlebot.com'],
        source:
          'https://developers.google.com/crawling/docs/crawlers-fetchers/verify-google-requests',
        checked: '2026-11-20',
      },
    ],
    signatureAgent: 'https://agent.bot.goog',
    directoryUrl: 'https://agent.bot.goog/.well-known/http-message-signatures-directory',
    verifiedByCapture: false,
    source: 'https://developers.google.com/crawling/docs/crawlers-fetchers/allow-google-agent',
    checked: '2026-11-20',
    ipLists: [
      {
        name: 'user-triggered-agents',
        url: 'https://developers.google.com/static/crawling/ipranges/user-triggered-agents.json',
        uaTokens: ['Google-Agent', 'Gemini-Deep-Research'],
      },
      {
        name: 'user-triggered-fetchers-google',
        url: 'https://developers.google.com/static/crawling/ipranges/user-triggered-fetchers-google.json',
        uaTokens: googleFetcherTokens,
      },
      {
        name: 'common-crawlers',
        url: 'https://developers.google.com/static/crawling/ipranges/common-crawlers.json',
        uaTokens: googleCommonTokens,
      },
      {
        name: 'user-triggered-fetchers',
        url: 'https://developers.google.com/static/crawling/ipranges/user-triggered-fetchers.json',
        uaTokens: [],
      },
    ],
  },
  {
    operator: 'kernel',
    signatureAgent: 'https://www.kernel.sh',
    directoryUrl: 'https://www.kernel.sh/.well-known/http-message-signatures-directory',
    intermediary: true,
    verifiedByCapture: false,
    source: 'https://www.kernel.sh/docs/bots',
    checked: '2026-11-23',
    ipLists: [],
    evidence: [
      {
        level: 'documented',
        source: 'https://www.kernel.sh/docs/bots',
        checked: '2026-11-23',
        note: 'Signs browser traffic for other tools or agents; verified identity names signing infrastructure, never the customer agent.',
      },
      {
        level: 'observed',
        source: 'https://www.kernel.sh/.well-known/http-message-signatures-directory',
        checked: '2026-11-23',
        note: 'Owner-supplied live HTTPS directory: HTTP 200, 1 Ed25519 key and 1 valid authority-binding directory proof. No local signed request capture.',
      },
    ],
  },
  {
    operator: 'cloudflare_browser_run',
    signatureAgent: 'https://web-bot-auth.cloudflare-browser-rendering-085.workers.dev',
    directoryUrl:
      'https://web-bot-auth.cloudflare-browser-rendering-085.workers.dev/.well-known/http-message-signatures-directory',
    intermediary: true,
    verifiedByCapture: false,
    source: 'https://developers.cloudflare.com/browser-run/reference/automatic-request-headers/',
    checked: '2026-11-23',
    ipLists: [],
    evidence: [
      {
        level: 'documented',
        source:
          'https://developers.cloudflare.com/browser-run/reference/automatic-request-headers/',
        checked: '2026-11-23',
        note: 'Signs browser traffic for other tools or agents; verified identity names signing infrastructure, never the customer agent.',
      },
      {
        level: 'observed',
        source:
          'https://web-bot-auth.cloudflare-browser-rendering-085.workers.dev/.well-known/http-message-signatures-directory',
        checked: '2026-11-23',
        note: 'Owner-supplied live HTTPS directory: HTTP 200, 3 Ed25519 keys and 3 valid authority-binding directory proofs. No local signed request capture.',
      },
    ],
  },
  {
    operator: 'shopify_cloudsurf',
    signatureAgent: 'https://cloudsurf.shopify.io',
    directoryUrl: 'https://cloudsurf.shopify.io/.well-known/http-message-signatures-directory',
    intermediary: true,
    verifiedByCapture: false,
    source: 'https://help.shopify.com/en/manual/intro-to-shopify/bots/cloudsurf',
    checked: '2026-11-23',
    ipLists: [],
    evidence: [
      {
        level: 'documented',
        source: 'https://help.shopify.com/en/manual/intro-to-shopify/bots/cloudsurf',
        checked: '2026-11-23',
        note: 'Signs browser traffic for other tools or agents; verified identity names signing infrastructure, never the customer agent.',
      },
      {
        level: 'observed',
        source: 'https://cloudsurf.shopify.io/.well-known/http-message-signatures-directory',
        checked: '2026-11-23',
        note: 'Owner-supplied live HTTPS directory: HTTP 200, 1 Ed25519 key and 1 valid authority-binding directory proof. No local signed request capture.',
      },
    ],
  },
  {
    operator: 'browserbase',
    // Cloud browser infrastructure that signs its customers' browser sessions (beta): a valid
    // signature identifies Browserbase, never the customer's agent.
    intermediary: true,
    evidence: [
      {
        level: 'documented',
        source: 'https://docs.browserbase.com/platform/identity/web-bot-auth',
        checked: '2026-11-22',
        note: "Browserbase signs its customers' browser-agent traffic with Web Bot Auth (beta, enabled per account); a signature does not identify the customer's agent or a human user.",
      },
      {
        level: 'observed',
        source: 'https://radar.cloudflare.com/bots/directory/browserbase',
        checked: '2026-11-22',
        note: 'WBA identity and directory observed by Cloudflare; live directory re-checked 2026-11-22 (two Ed25519 keys, valid directory signatures); no local request capture.',
      },
    ],
    signatureAgent: 'https://www.browserbase.com',
    directoryUrl: 'https://www.browserbase.com/.well-known/http-message-signatures-directory',
    verifiedByCapture: false,
    source: 'https://docs.browserbase.com/platform/identity/web-bot-auth',
    checked: '2026-11-22',
    ipLists: [],
  },
  {
    operator: 'manus',
    evidence: [
      {
        level: 'observed',
        source: 'https://radar.cloudflare.com/bots/directory/manus-bot',
        checked: '2026-11-20',
        note: 'WBA identity and directory observed by Cloudflare; old operator help URL is unavailable. Live directory re-checked 2026-11-22 (two Ed25519 keys without kid, thumbprint keyids, valid directory signatures).',
      },
    ],
    signatureAgent: 'https://api.manus.im',
    directoryUrl: 'https://api.manus.im/.well-known/http-message-signatures-directory',
    verifiedByCapture: false,
    source: 'https://radar.cloudflare.com/bots/directory/manus-bot',
    checked: '2026-11-22',
    ipLists: [],
  },
  {
    operator: 'anthropic',
    verifiedByCapture: false,
    source: 'https://claude.com/crawling/bots.json',
    checked: '2026-11-20',
    ipLists: [
      {
        name: 'bots',
        url: 'https://claude.com/crawling/bots.json',
        uaTokens: ['ClaudeBot', 'Claude-SearchBot', 'Claude-User'],
      },
      {
        name: 'sail',
        url: 'https://claude.com/.well-known/sail',
        uaTokens: ['Claude-Agent'],
        format: 'sail',
        service: 'Claude-Agent',
      },
    ],
  },
  {
    operator: 'perplexity',
    verifiedByCapture: false,
    source: 'https://docs.perplexity.ai/docs/resources/perplexity-crawlers',
    checked: '2026-11-20',
    ipLists: [
      {
        name: 'perplexitybot',
        url: 'https://www.perplexity.ai/perplexitybot.json',
        uaTokens: ['PerplexityBot'],
      },
      {
        name: 'perplexity-user',
        url: 'https://www.perplexity.ai/perplexity-user.json',
        uaTokens: ['Perplexity-User'],
      },
    ],
  },
];
export const defaultRegistry: Registry = operators.map((operator) => ({
  ...operator,
  evidence: operator.evidence ?? [
    {
      level:
        operator.ipLists.length ||
        operator.reverseDns?.length ||
        operator.staticPrefixes?.length ||
        operator.directoryUrl
          ? 'documented'
          : 'inferred',
      source: operator.source,
      checked: operator.checked,
      note:
        operator.ipLists.length ||
        operator.reverseDns?.length ||
        operator.staticPrefixes?.length ||
        operator.directoryUrl
          ? 'Operator documentation for the configured verification methods; verifiedByCapture is independent.'
          : 'Claim-only attribution; the linked source does not establish a verification method.',
    },
  ],
  purposes: purposePolicies[operator.operator],
  tokenClasses: tokenClassPolicies[operator.operator],
}));
